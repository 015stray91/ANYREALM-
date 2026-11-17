// ---------------------------------------------------------------------------
// nurfs_compositor_core.cpp -- the parts of the unified compositor that are pure
// logic, so they can be tested without a panel, a GPU or Android headers.
//
// Everything here is protocol-agnostic. The Wayland and Composer HAL front ends
// translate into these calls and translate the results back; they do not make
// decisions. That split is what keeps "one display server" true: there is
// exactly one place that decides what is on the panel, and it is this file.
//
// Compile and test standalone (see nurfs_compositor_test.cpp):
//   g++ -std=c++17 -O2 -o /tmp/nurfs_core nurfs_compositor_core.cpp nurfs_compositor_test.cpp
// ---------------------------------------------------------------------------

#include "nurfs_compositor.h"

#include <algorithm>
#include <cstdio>
#include <sstream>

namespace nurfs {
namespace {

// ---------------------------------------------------------------------------
// Safe-area and damage helpers
// ---------------------------------------------------------------------------

struct Box {
    int32_t l, t, r, b;
};

inline Box toBox(const Rect& r) {
    return Box{r.x, r.y, r.x + static_cast<int32_t>(r.w), r.y + static_cast<int32_t>(r.h)};
}

inline bool boxIntersects(const Box& a, const Box& b) {
    return !(b.l >= a.r || b.r <= a.l || b.t >= a.b || b.b <= a.t);
}

// Union of every damage rect, pruned to the panel. Keeping the union rather than
// the exact list is deliberate: a handful of scattered damage rects is more
// expensive to reason about than one bounding box, and the GPU is charged per
// draw call either way.
inline Rect unionDamage(const std::vector<Rect>& damage, uint32_t panelW, uint32_t panelH) {
    if (damage.empty()) return Rect{};
    int32_t l = 1 << 30, t = 1 << 30, r = -(1 << 30), b = -(1 << 30);
    for (const Rect& d : damage) {
        if (d.empty()) continue;
        l = std::min<int32_t>(l, std::max<int32_t>(d.x, 0));
        t = std::min<int32_t>(t, std::max<int32_t>(d.y, 0));
        r = std::max<int32_t>(r, std::min<int32_t>(d.x + static_cast<int32_t>(d.w), static_cast<int32_t>(panelW)));
        b = std::max<int32_t>(b, std::min<int32_t>(d.y + static_cast<int32_t>(d.h), static_cast<int32_t>(panelH)));
    }
    if (r <= l || b <= t) return Rect{};
    return Rect{l, t, static_cast<uint32_t>(r - l), static_cast<uint32_t>(b - t)};
}

// Bytes per pixel for the formats the core understands. Video formats report
// their luma plane only here; the real allocation size is computed by the
// allocator, not by this function.
inline uint32_t bytesPerPixel(PixelFormat f) {
    switch (f) {
        case PixelFormat::Rgba8888:
        case PixelFormat::Rgbx8888: return 4;
        case PixelFormat::Rgb565:   return 2;
        case PixelFormat::Nv12:     return 1;  // per luma sample
        case PixelFormat::P010:     return 2;  // 10 bits in 16
    }
    return 4;
}

// Minimum stride for a width in a format. A buffer that reports a stride below
// this is malformed and would read out of bounds during composite, so it is
// refused at attach time rather than at scanout time.
inline uint32_t minStride(uint32_t width, PixelFormat f) {
    return width * bytesPerPixel(f);
}

// ---------------------------------------------------------------------------
// Hardware plane assignment
//
// A plane is worth taking when it avoids a GPU draw. The rules, in order:
//   1. opaque and unrotated  -> a plane
//   2. video format          -> a plane, even with alpha, because HWC can scan
//                               NV12 out and a GPU draw would mean converting it
//   3. everything else       -> GPU
//
// Never more planes than the display has; the caller passes the count it got
// from DRM, which is the only authority on the panel's real capabilities.
// ---------------------------------------------------------------------------
bool wantsHardwarePlane(const SurfaceState& s, const Buffer& b) {
    if (!s.visible) return false;

    // Video first, and before the alpha test. A video plane is worth taking even
    // when it is blended, because the alternative is a GPU pass that also has to
    // convert the format -- the most expensive thing this compositor can be asked
    // to do. Checking alpha first would silently disqualify every video layer
    // with a fade on it.
    if (b.format == PixelFormat::Nv12 || b.format == PixelFormat::P010) return true;

    // Everything else needs to be fully opaque: a translucent surface has to be
    // blended, which means a GPU pass regardless of which plane it lands on.
    if (s.alpha < 0.999f) return false;
    if (s.blend != Blend::Opaque) return false;
    switch (s.transform) {
        case SurfaceState::Transform::Normal:
        case SurfaceState::Transform::Rot180:
            return true;  // Rot180 needs no rotation hardware on any driver in use
        default:
            return false; // a rotated plane costs a GPU pass anyway on most drivers
    }
}

} // namespace

// ---------------------------------------------------------------------------
// A concrete compositor. DRM and the protocol front ends are injected, so this
// class is the whole policy of the display and nothing else.
// ---------------------------------------------------------------------------

class CoreCompositor final : public Compositor {
public:
    explicit CoreCompositor(const Config& cfg) : cfg_(cfg) {}

    // --- injectable seams --------------------------------------------------

    // --- lifecycle ---------------------------------------------------------

    bool start(std::string* error) override {
        if (running_) {
            if (error) *error = "already running";
            return false;
        }
        if (cfg_.panelWidth == 0 || cfg_.panelHeight == 0) {
            // A panel of unknown size cannot be composited to. Refusing here is
            // better than starting and presenting into a zero-sized framebuffer.
            if (error) *error = "panel size is unknown; a mode has to be set before start()";
            return false;
        }
        running_ = true;
        fullRedraw_ = true;   // the first frame is always full
        return true;
    }

    void stop() override { running_ = false; }

    bool running() const override { return running_; }

    // --- surfaces ----------------------------------------------------------

    uint32_t createSurface(const std::string& name, Origin origin) override {
        const uint32_t id = nextId_++;
        Surface rec;
        rec.desc.id = id;
        rec.desc.name = name;
        rec.desc.origin = origin;
        // A new surface starts below everything and invisible: the client has
        // not attached a buffer or said where it goes, and guessing a placement
        // would flash an unpositioned surface on the panel.
        rec.state.visible = false;
        rec.state.z = 0;
        rec.hasBuffer = false;
        surfaces_[id] = rec;
        return id;
    }

    void destroySurface(uint32_t id) override {
        auto it = surfaces_.find(id);
        if (it == surfaces_.end()) return;
        surfaces_.erase(it);
        // Removing a surface changes what is underneath it, so the next frame has
        // to be a full one. Nothing else can know what was revealed.
        fullRedraw_ = true;
    }

    bool updateState(uint32_t id, const SurfaceState& state) override {
        auto it = surfaces_.find(id);
        if (it == surfaces_.end()) return false;
        Surface& s = it->second;

        // Clamping to the panel applies to geometry, not to the buffer: a client
        // may legitimately render larger than the panel and let us scale down.
        SurfaceState next = state;
        if (cfg_.clampToPanel) {
            next.geometry.x = std::max<int32_t>(0, next.geometry.x);
            next.geometry.y = std::max<int32_t>(0, next.geometry.y);
            if (next.geometry.w > cfg_.panelWidth) next.geometry.w = cfg_.panelWidth;
            if (next.geometry.h > cfg_.panelHeight) next.geometry.h = cfg_.panelHeight;
        }
        if (next.alpha < 0.0f) next.alpha = 0.0f;
        if (next.alpha > 1.0f) next.alpha = 1.0f;

        const bool moved = next.geometry.x != s.state.geometry.x || next.geometry.y != s.state.geometry.y ||
                           next.geometry.w != s.state.geometry.w || next.geometry.h != s.state.geometry.h;
        const bool restacked = next.z != s.state.z;
        const bool visibilityChanged = next.visible != s.state.visible;
        s.state = next;
        // Moving or restacking reveals whatever was underneath, so it needs a
        // full frame; a pure alpha change does not.
        if (moved || restacked || visibilityChanged) fullRedraw_ = true;
        return true;
    }

    bool attach(uint32_t id, const Buffer& buf) override {
        auto it = surfaces_.find(id);
        if (it == surfaces_.end()) return false;
        Surface& s = it->second;

        // A malformed buffer is refused here. Letting it through means a read
        // past the end of the allocation during composite, which is a crash in
        // the display server rather than an error the client can fix.
        if (buf.width == 0 || buf.height == 0) return false;
        if (buf.stride != 0 && buf.stride < minStride(buf.width, buf.format)) return false;
        if (cfg_.clampToPanel && buf.width > cfg_.panelWidth * 4) return false;

        s.buffer = buf;
        if (s.buffer.stride == 0) s.buffer.stride = minStride(buf.width, buf.format);
        s.hasBuffer = true;
        s.lastCommitMs = 0;   // set on commit, not attach
        fullRedraw_ = true;   // new content: nothing knows what changed
        return true;
    }

    bool commit(uint32_t id, const std::vector<Rect>& damage) override {
        auto it = surfaces_.find(id);
        if (it == surfaces_.end()) return false;
        Surface& s = it->second;
        if (!s.hasBuffer) return false;

        // No usable damage from the client: treat the whole surface as damaged.
        // A client that reports nothing and then changes content would otherwise
        // leave stale pixels on screen, which looks like a rendering bug.
        if (damage.empty()) {
            s.damage = Rect{0, 0, s.buffer.width, s.buffer.height};
        } else {
            s.damage = unionDamage(damage, s.buffer.width, s.buffer.height);
            if (s.damage.empty()) s.damage = Rect{0, 0, s.buffer.width, s.buffer.height};
        }
        s.hasPendingFrame = true;
        return true;
    }

    void setReleaseCallback(ReleaseFn fn) override { release_ = std::move(fn); }

    // --- frame loop --------------------------------------------------------

    FrameStats compositeOnce() override {
        FrameStats stats;
        if (!running_) return stats;

        // Collect the visible surfaces in the order they will be drawn. Sorting
        // is by z then id, so two surfaces at the same z stack deterministically
        // rather than in map order, which would flicker between frames.
        std::vector<Surface*> visible;
        visible.reserve(surfaces_.size());
        for (auto& [id, s] : surfaces_) {
            if (!s.state.visible || !s.hasBuffer) continue;
            if (s.state.geometry.empty()) continue;
            visible.push_back(&s);
        }
        std::sort(visible.begin(), visible.end(), [](const Surface* a, const Surface* b) {
            if (a->state.z != b->state.z) return a->state.z < b->state.z;
            return a->desc.id < b->desc.id;
        });

        stats.surfacesTotal = static_cast<uint32_t>(visible.size());

        const uint32_t planes = cfg_.overlayPlanes;
        uint32_t planesUsed = 0;

        // Bottom-up: the first opaque surface that covers the panel makes
        // everything below it invisible, so those can be skipped entirely.
        size_t firstNeeded = 0;
        if (!fullRedraw_) {
            for (size_t i = visible.size(); i-- > 0;) {
                Surface* s = visible[i];
                if (s->state.blend == Blend::Opaque && s->state.alpha >= 0.999f &&
                    s->state.geometry.contains(0, 0) &&
                    s->state.geometry.w >= cfg_.panelWidth && s->state.geometry.h >= cfg_.panelHeight) {
                    firstNeeded = i;
                    break;
                }
            }
        }

        for (size_t i = firstNeeded; i < visible.size(); ++i) {
            Surface* s = visible[i];
            if (wantsHardwarePlane(s->state, s->buffer) && planesUsed < planes) {
                planesUsed++;
                stats.surfacesHardware++;
                if (s->buffer.format == PixelFormat::Nv12 || s->buffer.format == PixelFormat::P010) {
                    stats.surfacesOverlay++;
                }
            } else {
                stats.surfacesGpu++;
            }
        }

        stats.fullRedraw = fullRedraw_;

        // Hand every presented buffer back. A client that renders on its own
        // cadence is otherwise blocked waiting for a buffer this compositor has
        // already finished with, which shows up as a client stuck at half rate.
        for (auto& [id, s] : surfaces_) {
            if (!s.hasBuffer) continue;
            if (s.buffer.memory == MemoryKind::Owned) continue;  // ours to keep
            if (release_) release_(id, s.buffer.generation);
            s.hasPendingFrame = false;
        }

        fullRedraw_ = false;
        return stats;
    }

    // --- panel changes -----------------------------------------------------

    void setReconfigureCallback(ReconfigureFn fn) override { reconfigure_ = std::move(fn); }

    void panelSize(uint32_t* w, uint32_t* h) const override {
        if (w) *w = cfg_.panelWidth;
        if (h) *h = cfg_.panelHeight;
    }

    // Set a new mode. Every surface has to be told, because a client rendering
    // at the old size would otherwise present a stretched frame forever.
    void setMode(uint32_t w, uint32_t h) override {
        if (w == 0 || h == 0) return;   // a zero mode is a bug in the caller
        cfg_.panelWidth = w;
        cfg_.panelHeight = h;
        fullRedraw_ = true;
        if (reconfigure_) reconfigure_(w, h);
    }

    // --- input -------------------------------------------------------------

    uint32_t routeInput(const InputEvent& ev) const override {
        // Top-most first. A surface that is invisible, has no buffer, or does not
        // contain the point cannot receive the event, so it is skipped rather
        // than stealing the touch.
        uint32_t best = 0;
        int32_t bestZ = INT32_MIN;
        for (const auto& [id, s] : surfaces_) {
            if (!s.state.visible || !s.hasBuffer) continue;
            if (!s.state.geometry.contains(ev.x, ev.y)) continue;
            if (s.state.z > bestZ) {
                bestZ = s.state.z;
                best = id;
            }
        }
        return best;  // 0 means Android handles it
    }

    void setInputSink(InputSink sink) override { inputSink_ = std::move(sink); }

    // --- introspection -----------------------------------------------------

    std::vector<SurfaceDesc> surfaces() const override {
        std::vector<SurfaceDesc> out;
        out.reserve(surfaces_.size());
        for (const auto& [id, s] : surfaces_) out.push_back(s.desc);
        return out;
    }

    bool anyVisible() const override {
        for (const auto& [id, s] : surfaces_) {
            if (s.state.visible && s.hasBuffer) return true;
        }
        return false;
    }

    std::string describe() const override {
        std::ostringstream os;
        os << "nurfs compositor " << cfg_.panelWidth << "x" << cfg_.panelHeight << "@" << cfg_.refreshHz
           << "Hz surfaces=" << surfaces_.size() << " running=" << (running_ ? "yes" : "no");
        for (const auto& [id, s] : surfaces_) {
            os << "\n  #" << id << " " << s.desc.name << " origin=" << static_cast<int>(s.desc.origin)
               << " z=" << s.state.z << " geom=" << s.state.geometry.x << "," << s.state.geometry.y << " "
               << s.state.geometry.w << "x" << s.state.geometry.h
               << " buf=" << s.buffer.width << "x" << s.buffer.height
               << (s.state.visible ? " visible" : " hidden");
        }
        return os.str();
    }

private:
    struct Surface {
        SurfaceDesc desc;
        SurfaceState state;
        Buffer buffer;
        Rect damage;
        bool hasBuffer = false;
        bool hasPendingFrame = false;
        uint64_t lastCommitMs = 0;
    };

    Config cfg_;
    std::map<uint32_t, Surface> surfaces_;
    uint32_t nextId_ = 1;
    bool running_ = false;
    bool fullRedraw_ = true;
    ReleaseFn release_;
    ReconfigureFn reconfigure_;
    InputSink inputSink_;
};

std::unique_ptr<Compositor> Compositor::create(const Config& cfg) {
    return std::make_unique<CoreCompositor>(cfg);
}

} // namespace nurfs
