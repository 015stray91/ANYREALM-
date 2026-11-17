// ---------------------------------------------------------------------------
// nurfs_compositor.h -- one display server, two protocols, from boot.
//
// The wrong design, which this replaces: SurfaceFlinger on one side, a Wayland
// compositor on the other, with frames handed between them. That is two display
// servers disagreeing about who owns the panel, and no amount of handoff code
// fixes it. It is the display-server equivalent of chroot: two things pretending
// to be one.
//
// NURFS is one system, so there is one display server. It starts at boot, owns
// the DRM device and the panel, and speaks *both* protocols natively:
//
//   - Android's side: the Composer HAL entry points that SurfaceFlinger's
//     clients were built against. Android apps, SystemUI and the HWC path keep
//     working because the HAL is present, not because a shim forwards it.
//   - Linux's side: wayland-server, so phoc, KWin, the GlacierUI shell or any
//     other Wayland client connects the ordinary way.
//
// Both are surface producers into the same scene, composited by the same code,
// scanned out by the same atomic commit. There is no second display server, no
// nested compositor, and no frame copy between halves. That is what "native
// unified" means here: one compositor, not a bridge between two.
//
// The surface model has to serve both, which is what shapes it. Wayland's model
// is a tree of surfaces with per-surface buffers, damage and input regions.
// Android's is a list of layers with a z-order, a crop and a blend mode, handed
// over per frame. Those are the same thing viewed differently, so the core type
// here is one surface record carrying both attribute sets, and the two protocol
// front ends only translate; they do not decide anything.
// ---------------------------------------------------------------------------

#ifndef NURFS_COMPOSITOR_H
#define NURFS_COMPOSITOR_H

#include <cstdint>
#include <cstddef>
#include <string>
#include <vector>
#include <memory>
#include <functional>
#include <map>

namespace nurfs {

// ---------------------------------------------------------------------------
// Buffers
// ---------------------------------------------------------------------------

enum class PixelFormat : uint32_t {
    Rgba8888 = 1,   // Wayland's default on most clients
    Rgbx8888 = 2,
    Rgb565 = 3,     // Android's low-end layer format
    Nv12 = 4,       // video; HWC can scan this out without a conversion
    P010 = 5,       // 10-bit video
};

enum class MemoryKind : uint32_t {
    // dma-buf. The only kind that can become a hardware plane, and the only one
    // that costs no copy when a client is on the same GPU.
    DmaBuf = 1,
    // mmap'd shared memory. For software clients and for the case where the GPU
    // driver refuses to export; always works, costs one copy per frame.
    Shm = 2,
    // A buffer this compositor owns, used when the client hands over a
    // description rather than memory (Android HWC does this).
    Owned = 3,
};

struct Buffer {
    MemoryKind memory = MemoryKind::DmaBuf;
    PixelFormat format = PixelFormat::Rgba8888;
    int fd = -1;              // dma-buf or shm fd; -1 for Owned
    uint32_t width = 0;
    uint32_t height = 0;
    uint32_t stride = 0;      // bytes per row, 0 = derive from width and format
    uint64_t modifier = 0;    // DRM format modifier; 0 = linear
    uint32_t fenceFd = -1;    // acquire fence, -1 = already idle
    uint32_t generation = 0;  // bumped on every reuse, so a stale reference is detectable
};

struct Rect {
    int32_t x = 0, y = 0;
    uint32_t w = 0, h = 0;

    bool empty() const { return w == 0 || h == 0; }
    bool contains(int32_t px, int32_t py) const {
        return px >= x && py >= y && px < x + static_cast<int32_t>(w) && py < y + static_cast<int32_t>(h);
    }
    bool intersects(const Rect& o) const {
        return !(o.x >= x + static_cast<int32_t>(w) || o.x + static_cast<int32_t>(o.w) <= x ||
                 o.y >= y + static_cast<int32_t>(h) || o.y + static_cast<int32_t>(o.h) <= y);
    }
};

// ---------------------------------------------------------------------------
// Surfaces: the single model both protocols translate into
// ---------------------------------------------------------------------------

// Who created the surface. This is bookkeeping and logging, never a branch in
// the compositing path: a surface is a surface regardless of who asked for it.
enum class Origin : uint32_t { Android = 1, Wayland = 2, Internal = 3 };

enum class Blend : uint32_t {
    Opaque = 1,     // no blending; lets HWC use a hardware plane
    Premultiplied = 2,
    Coverage = 3,
};

struct SurfaceState {
    Rect geometry;             // where it lands on the panel, in panel pixels
    Rect sourceCrop;           // which part of the buffer to sample
    int32_t z = 0;             // stacking order; higher is on top
    float alpha = 1.0f;
    Blend blend = Blend::Premultiplied;
    bool visible = true;
    // Android calls this the transform; Wayland calls it the buffer transform.
    // Same rotation, same meaning, so it is stored once.
    enum class Transform : uint32_t { Normal = 0, Rot90 = 1, Rot180 = 2, Rot270 = 3, Flipped = 4, Flipped90 = 5, Flipped180 = 6, Flipped270 = 7 };
    Transform transform = Transform::Normal;
};

struct SurfaceDesc {
    uint32_t id = 0;
    std::string name;
    Origin origin = Origin::Internal;
    // Android's layer id, when this surface came from the Composer HAL. Kept so
    // a HAL client can match its own layers to what it holds.
    uint64_t androidLayerId = 0;
    // Wayland's client resource, opaque to the core.
    void* waylandResource = nullptr;
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

enum class InputKind : uint32_t { Down = 1, Up = 2, Move = 3, Cancel = 4, Axis = 5 };

struct InputEvent {
    InputKind kind = InputKind::Down;
    int32_t x = 0, y = 0;      // panel coordinates
    uint32_t pointerId = 0;
    uint64_t timeMs = 0;
    // For Axis: the scroll delta, in panel pixels.
    double axisX = 0, axisY = 0;
};

// ---------------------------------------------------------------------------
// The compositor
// ---------------------------------------------------------------------------

class Compositor {
public:
    struct Config {
        // The DRM node the compositor owns. Opening it is the act that makes this
        // the single display server; a second process opening it is what the old
        // two-compositor design did, and it is not supported.
        std::string drmNode = "/dev/dri/card0";
        uint32_t refreshHz = 60;
        // The panel mode. Filled in by the DRM front end from the connector's
        // preferred mode before start(); a compositor cannot composite to a size
        // nobody has told it.
        uint32_t panelWidth = 0;
        uint32_t panelHeight = 0;
        // Overlay planes the panel can scan out without a GPU pass. The DRM front
        // end fills this in from the atomic plane list; 0 means "composite
        // everything on the GPU", which is always correct and always slower.
        uint32_t overlayPlanes = 0;
        // Refuse buffers larger than the panel. A client rendering at 4x panel
        // size costs bandwidth every frame for no visible gain; scaling in HWC
        // is cheaper than sampling a huge buffer.
        bool clampToPanel = true;
        // When a Wayland client stops committing, hide its surface rather than
        // leaving the last frame on screen. A frozen frame reads as a hang.
        uint32_t staleTimeoutMs = 1500;
        // Start with the Android HAL registered. A device that boots to Linux
        // first sets this false and registers later.
        bool registerComposerHal = true;
        // The protocol front ends to bring up at boot. Both are on by default:
        // "one compositor" is only true if both are actually serving.
        bool serveWayland = true;
        bool serveComposerHal = true;
    };

    static std::unique_ptr<Compositor> create(const Config& cfg);
    virtual ~Compositor() = default;

    // --- lifecycle ---------------------------------------------------------

    // Takes the DRM master lock, sets the initial mode, starts the protocol
    // front ends. Returns false with a reason when the panel cannot be acquired;
    // the caller decides whether that is fatal.
    virtual bool start(std::string* error) = 0;
    virtual void stop() = 0;
    virtual bool running() const = 0;

    // --- surfaces ----------------------------------------------------------

    virtual uint32_t createSurface(const std::string& name, Origin origin) = 0;
    virtual void destroySurface(uint32_t id) = 0;
    virtual bool updateState(uint32_t id, const SurfaceState& state) = 0;

    // Attach a buffer. The compositor keeps a reference until the client reuses
    // it, which is what the release callback reports.
    virtual bool attach(uint32_t id, const Buffer& buf) = 0;

    // Damage from this frame's commit. Only the damaged region is recomposited;
    // a full-screen damage report on every frame is treated as "the client does
    // not know", not as a reason to redraw everything.
    virtual bool commit(uint32_t id, const std::vector<Rect>& damage) = 0;

    using ReleaseFn = std::function<void(uint32_t surfaceId, uint32_t generation)>;
    virtual void setReleaseCallback(ReleaseFn fn) = 0;

    // --- frame loop --------------------------------------------------------

    // Composites once and hands the result to DRM. Called by the loop the
    // compositor runs internally, and exposed so a test can drive one frame.
    struct FrameStats {
        uint32_t compositeMs = 0;
        uint32_t surfacesTotal = 0;
        uint32_t surfacesHardware = 0;  // took a DRM plane; no GPU work
        uint32_t surfacesGpu = 0;       // had to be drawn by the GPU
        uint32_t surfacesOverlay = 0;   // video, scanned out directly
        bool fullRedraw = false;
    };
    virtual FrameStats compositeOnce() = 0;

    // --- panel changes -----------------------------------------------------

    using ReconfigureFn = std::function<void(uint32_t w, uint32_t h)>;
    virtual void setReconfigureCallback(ReconfigureFn fn) = 0;
    virtual void panelSize(uint32_t* w, uint32_t* h) const = 0;

    // Adopt a new mode. Called by the DRM front end when the connector reports a
    // change (rotation, external display, mode switch). Every client is notified,
    // because a client rendering at the old size would present a stretched frame
    // indefinitely.
    virtual void setMode(uint32_t w, uint32_t h) = 0;

    // --- input -------------------------------------------------------------

    // Routes one event to the surface that owns the pixel, honouring z-order.
    // Returns the surface id, or 0 when Android should get it.
    virtual uint32_t routeInput(const InputEvent& ev) const = 0;
    using InputSink = std::function<void(uint32_t surfaceId, const InputEvent&)>;
    virtual void setInputSink(InputSink sink) = 0;

    // --- introspection -----------------------------------------------------

    virtual std::vector<SurfaceDesc> surfaces() const = 0;
    virtual bool anyVisible() const = 0;
    virtual std::string describe() const = 0;
};

} // namespace nurfs

#endif // NURFS_COMPOSITOR_H
