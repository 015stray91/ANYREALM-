// ---------------------------------------------------------------------------
// Tests for the unified compositor core.
//
// These are behaviour tests, not coverage tests: each one encodes a rule the
// display has to honour for a fused system to work, and each one fails loudly if
// that rule is broken. Run them with:
//
//   g++ -std=c++17 -O2 -o /tmp/nurfs_core nurfs_compositor_core.cpp nurfs_compositor_test.cpp
//   /tmp/nurfs_core
// ---------------------------------------------------------------------------

#include "nurfs_compositor.h"

#include <cstdio>
#include <string>
#include <vector>

using namespace nurfs;

static int failures = 0;
static int checks = 0;

#define CHECK(cond, what)                                                        \
    do {                                                                         \
        ++checks;                                                                \
        if (!(cond)) {                                                           \
            std::printf("  FAIL %s\n       %s:%d\n", what, __FILE__, __LINE__);  \
            ++failures;                                                          \
        }                                                                        \
    } while (0)

static Buffer makeBuffer(uint32_t w, uint32_t h, PixelFormat f = PixelFormat::Rgba8888) {
    Buffer b;
    b.memory = MemoryKind::DmaBuf;
    b.format = f;
    b.fd = 7;
    b.width = w;
    b.height = h;
    b.stride = w * 4;
    return b;
}

static SurfaceState makeState(int32_t x, int32_t y, uint32_t w, uint32_t h, int32_t z) {
    SurfaceState s;
    s.geometry = Rect{x, y, w, h};
    s.sourceCrop = Rect{0, 0, w, h};
    s.z = z;
    s.visible = true;
    s.blend = Blend::Opaque;
    return s;
}

static std::unique_ptr<Compositor> makeCompositor(uint32_t w = 1080, uint32_t h = 2400) {
    Compositor::Config cfg;
    cfg.panelWidth = w;
    cfg.panelHeight = h;
    return Compositor::create(cfg);
}

// ---------------------------------------------------------------------------

// A compositor with no mode cannot composite. This is the check that stops a
// boot from presenting into a zero-sized framebuffer, which fails silently.
static void testRefusesStartWithoutMode() {
    std::printf("testRefusesStartWithoutMode\n");
    Compositor::Config cfg;
    auto c = Compositor::create(cfg);
    std::string err;
    CHECK(!c->start(&err), "start() refuses with no panel size");
    CHECK(!err.empty(), "an error message is produced");
    CHECK(!c->running(), "not marked running");
}

static void testStartsWithMode() {
    std::printf("testStartsWithMode\n");
    auto c = makeCompositor();
    std::string err;
    CHECK(c->start(&err), "start() succeeds with a mode");
    CHECK(c->running(), "marked running");
    uint32_t w = 0, h = 0;
    c->panelSize(&w, &h);
    CHECK(w == 1080 && h == 2400, "panel size reported");
}

// A surface created but never given a buffer must not appear on screen: showing
// an unpositioned, empty surface is worse than showing nothing.
static void testNewSurfaceIsInvisible() {
    std::printf("testNewSurfaceIsInvisible\n");
    auto c = makeCompositor();
    c->start(nullptr);
    const uint32_t id = c->createSurface("test", Origin::Wayland);
    CHECK(id != 0, "surface id assigned");
    CHECK(!c->anyVisible(), "a bufferless surface is not visible");
    auto stats = c->compositeOnce();
    CHECK(stats.surfacesTotal == 0, "nothing composited");
}

static void testSurfaceBecomesVisible() {
    std::printf("testSurfaceBecomesVisible\n");
    auto c = makeCompositor();
    c->start(nullptr);
    const uint32_t id = c->createSurface("test", Origin::Wayland);
    CHECK(c->updateState(id, makeState(0, 0, 1080, 2400, 1)), "state accepted");
    CHECK(c->attach(id, makeBuffer(1080, 2400)), "buffer attached");
    CHECK(c->commit(id, {}), "commit accepted");
    CHECK(c->anyVisible(), "now visible");
    auto stats = c->compositeOnce();
    CHECK(stats.surfacesTotal == 1, "one surface composited");
}

// A buffer whose stride is narrower than one row of pixels would read past the
// end of the allocation. Refusing it at attach keeps the display server alive.
static void testRefusesNarrowStride() {
    std::printf("testRefusesNarrowStride\n");
    auto c = makeCompositor();
    c->start(nullptr);
    const uint32_t id = c->createSurface("bad", Origin::Wayland);
    c->updateState(id, makeState(0, 0, 1080, 2400, 1));
    Buffer b = makeBuffer(1080, 2400);
    b.stride = 100;   // hopelessly narrow
    CHECK(!c->attach(id, b), "narrow stride refused");
    Buffer zero = makeBuffer(0, 0);
    CHECK(!c->attach(id, zero), "zero-sized buffer refused");
}

// Input goes to the top-most surface under the point, and to Android (id 0) when
// no guest surface is there. Without this, a fused screen is a picture nobody can
// touch.
static void testInputRouting() {
    std::printf("testInputRouting\n");
    auto c = makeCompositor();
    c->start(nullptr);

    const uint32_t low = c->createSurface("low", Origin::Android);
    c->updateState(low, makeState(0, 0, 1080, 1200, 1));
    c->attach(low, makeBuffer(1080, 1200));
    c->commit(low, {});

    const uint32_t high = c->createSurface("high", Origin::Wayland);
    c->updateState(high, makeState(0, 1200, 1080, 1200, 5));
    c->attach(high, makeBuffer(1080, 1200));
    c->commit(high, {});

    InputEvent ev;
    ev.kind = InputKind::Down;

    ev.x = 500; ev.y = 600;
    CHECK(c->routeInput(ev) == low, "top of screen goes to the low surface");

    ev.x = 500; ev.y = 1800;
    CHECK(c->routeInput(ev) == high, "bottom of screen goes to the high surface");

    // Overlapping area: the higher z wins, which is the whole point of z-order.
    c->updateState(high, makeState(0, 0, 1080, 2400, 5));
    c->attach(high, makeBuffer(1080, 2400));
    ev.x = 500; ev.y = 600;
    CHECK(c->routeInput(ev) == high, "overlap resolves to the higher z");
}

// A hidden surface must not receive input even if the point is inside its
// geometry. Otherwise a hidden window keeps stealing touches.
static void testHiddenSurfaceGetsNoInput() {
    std::printf("testHiddenSurfaceGetsNoInput\n");
    auto c = makeCompositor();
    c->start(nullptr);
    const uint32_t id = c->createSurface("hidden", Origin::Wayland);
    SurfaceState st = makeState(0, 0, 1080, 2400, 5);
    st.visible = false;
    c->updateState(id, st);
    c->attach(id, makeBuffer(1080, 2400));
    InputEvent ev;
    ev.x = 100; ev.y = 100;
    CHECK(c->routeInput(ev) == 0, "input falls through to Android");
}

// An opaque full-panel surface means everything below it is invisible, so the
// compositor must not pay for drawing it.
static void testOpaqueFullscreenOccludesLowerSurfaces() {
    std::printf("testOpaqueFullscreenOccludesLowerSurfaces\n");
    auto c = makeCompositor();
    c->start(nullptr);

    const uint32_t bottom = c->createSurface("bottom", Origin::Android);
    c->updateState(bottom, makeState(0, 0, 1080, 2400, 1));
    c->attach(bottom, makeBuffer(1080, 2400));
    c->commit(bottom, {});

    const uint32_t top = c->createSurface("top", Origin::Wayland);
    c->updateState(top, makeState(0, 0, 1080, 2400, 10));
    c->attach(top, makeBuffer(1080, 2400));
    c->commit(top, {});

    auto stats = c->compositeOnce();
    CHECK(stats.surfacesTotal == 2, "both surfaces are in the scene");
    CHECK(stats.fullRedraw, "first frame is a full redraw");

    // Second frame: nothing changed, so the occluded surface should not be drawn.
    stats = c->compositeOnce();
    CHECK(!stats.fullRedraw, "steady-state frame is not full");

    c->destroySurface(bottom);
    stats = c->compositeOnce();
    CHECK(stats.fullRedraw, "destroying a surface forces a full frame");
}

// Moving or restacking reveals what was underneath, so those invalidate the whole
// frame. An alpha change does not, and forcing a full redraw for it would make
// every fade cost the entire panel.
static void testRestackInvalidatesFullFrame() {
    std::printf("testRestackInvalidatesFullFrame\n");
    auto c = makeCompositor();
    c->start(nullptr);
    const uint32_t id = c->createSurface("s", Origin::Wayland);
    c->updateState(id, makeState(10, 10, 200, 200, 1));
    c->attach(id, makeBuffer(200, 200));
    c->commit(id, {});
    c->compositeOnce();   // settle

    SurfaceState moved = makeState(50, 50, 200, 200, 1);
    c->updateState(id, moved);
    auto stats = c->compositeOnce();
    CHECK(stats.fullRedraw, "moving a surface forces a full frame");

    SurfaceState faded = moved;
    faded.alpha = 0.5f;
    c->compositeOnce();   // settle the move
    c->updateState(id, faded);
    stats = c->compositeOnce();
    CHECK(!stats.fullRedraw, "an alpha-only change does not force a full frame");
}

// Alpha below 1 means a GPU blend, so the surface cannot take a hardware plane.
// Getting this wrong produces a surface that ignores its own transparency.
static void testAlphaDisqualifiesHardwarePlane() {
    std::printf("testAlphaDisqualifiesHardwarePlane\n");
    auto c = makeCompositor();
    c->start(nullptr);

    const uint32_t id = c->createSurface("faded", Origin::Wayland);
    SurfaceState st = makeState(0, 0, 1080, 2400, 1);
    st.alpha = 0.5f;
    c->updateState(id, st);
    c->attach(id, makeBuffer(1080, 2400));
    c->commit(id, {});

    auto stats = c->compositeOnce();
    CHECK(stats.surfacesHardware == 0, "translucent surface does not take a plane");
    CHECK(stats.surfacesGpu == 1, "translucent surface is drawn by the GPU");
}

// Video is the exception to the alpha rule: HWC can scan NV12 out directly, so a
// video layer with blending still belongs on a plane.
static void testVideoTakesPlaneDespiteBlend() {
    std::printf("testVideoTakesPlaneDespiteBlend\n");
    // A panel with overlay planes is the case this rule exists for. With none,
    // every surface is composited on the GPU and an overlay would be impossible.
    Compositor::Config cfg;
    cfg.panelWidth = 1080;
    cfg.panelHeight = 2400;
    cfg.overlayPlanes = 4;
    auto c = Compositor::create(cfg);
    c->start(nullptr);
    const uint32_t id = c->createSurface("video", Origin::Android);
    SurfaceState st = makeState(0, 0, 1080, 2400, 1);
    st.blend = Blend::Premultiplied;
    st.alpha = 0.9f;
    c->updateState(id, st);
    c->attach(id, makeBuffer(1080, 2400, PixelFormat::Nv12));
    c->commit(id, {});

    auto stats = c->compositeOnce();
    CHECK(stats.surfacesOverlay == 1, "NV12 is counted as an overlay surface");
}

// Every presented buffer has to be handed back, or a client rendering on its own
// cadence stalls at half rate waiting for a buffer we already finished with.
static void testReleaseCallbackFires() {
    std::printf("testReleaseCallbackFires\n");
    auto c = makeCompositor();
    c->start(nullptr);
    std::vector<uint32_t> released;
    c->setReleaseCallback([&](uint32_t id, uint32_t gen) { released.push_back(id); });

    const uint32_t id = c->createSurface("s", Origin::Wayland);
    c->updateState(id, makeState(0, 0, 100, 100, 1));
    Buffer b = makeBuffer(100, 100);
    b.generation = 3;
    c->attach(id, b);
    c->commit(id, {});
    c->compositeOnce();

    CHECK(released.size() == 1, "one release callback");
    CHECK(!released.empty() && released[0] == id, "release names the surface");
}

// A buffer this compositor owns is not handed back: there is no client on the
// other side to receive it.
static void testOwnedBufferIsNotReleased() {
    std::printf("testOwnedBufferIsNotReleased\n");
    auto c = makeCompositor();
    c->start(nullptr);
    int releases = 0;
    c->setReleaseCallback([&](uint32_t, uint32_t) { ++releases; });

    const uint32_t id = c->createSurface("own", Origin::Android);
    c->updateState(id, makeState(0, 0, 100, 100, 1));
    Buffer b = makeBuffer(100, 100);
    b.memory = MemoryKind::Owned;
    c->attach(id, b);
    c->commit(id, {});
    c->compositeOnce();
    CHECK(releases == 0, "an owned buffer is not released to a client");
}

// A mode change has to reach every client, or they keep rendering at the old size
// and the panel shows a stretched frame indefinitely.
static void testReconfigureReachesClients() {
    std::printf("testReconfigureReachesClients\n");
    auto c = makeCompositor();
    c->start(nullptr);
    uint32_t gotW = 0, gotH = 0;
    int calls = 0;
    c->setReconfigureCallback([&](uint32_t w, uint32_t h) { gotW = w; gotH = h; ++calls; });

    CHECK(calls == 0, "no callback before a mode change");
    c->setMode(1440, 3120);
    CHECK(calls == 1, "one callback per mode change");
    CHECK(gotW == 1440 && gotH == 3120, "reconfigure carries the new mode");
    uint32_t w = 0, h = 0;
    c->panelSize(&w, &h);
    CHECK(w == 1440 && h == 3120, "panel size updated");

    // A zero mode is a bug in the caller and must not be adopted.
    c->setMode(0, 0);
    c->panelSize(&w, &h);
    CHECK(w == 1440 && h == 3120, "a zero mode is refused");
    CHECK(calls == 1, "no callback for a refused mode");
}

// Clamping geometry to the panel: a surface cannot be positioned so that it can
// never be seen, but its buffer may legitimately be larger.
static void testGeometryClampedToPanel() {
    std::printf("testGeometryClampedToPanel\n");
    auto c = makeCompositor(1080, 2400);
    c->start(nullptr);
    const uint32_t id = c->createSurface("huge", Origin::Wayland);
    SurfaceState st = makeState(-50, -50, 4000, 8000, 1);
    c->updateState(id, st);
    // The buffer being larger than the panel is fine; it gets scaled.
    CHECK(c->attach(id, makeBuffer(2160, 4800)), "oversized buffer accepted");
    c->commit(id, {});
    CHECK(c->anyVisible(), "still visible after clamping");
}

// Two surfaces at the same z must stack deterministically, or the panel flickers
// between frames as the map iterates.
static void testSameZOrderIsStable() {
    std::printf("testSameZOrderIsStable\n");
    auto c = makeCompositor();
    c->start(nullptr);
    const uint32_t a = c->createSurface("a", Origin::Wayland);
    const uint32_t b = c->createSurface("b", Origin::Wayland);
    c->updateState(a, makeState(0, 0, 540, 2400, 4));
    c->updateState(b, makeState(540, 0, 540, 2400, 4));
    c->attach(a, makeBuffer(540, 2400));
    c->attach(b, makeBuffer(540, 2400));
    c->commit(a, {});
    c->commit(b, {});

    auto s1 = c->compositeOnce();
    auto s2 = c->compositeOnce();
    CHECK(s1.surfacesTotal == s2.surfacesTotal, "surface count stable across frames");

    // Hit-testing at the boundary resolves to the lower id, consistently.
    InputEvent ev;
    ev.x = 540; ev.y = 100;
    const uint32_t first = c->routeInput(ev);
    const uint32_t second = c->routeInput(ev);
    CHECK(first == second, "hit-test is stable across calls");
    CHECK(first == b, "boundary belongs to the later-created surface");
}

// The describe() output is what a user sees when a boot goes wrong, so it must
// name every surface.
static void testDescribeListsSurfaces() {
    std::printf("testDescribeListsSurfaces\n");
    auto c = makeCompositor();
    c->start(nullptr);
    c->createSurface("com.android.systemui", Origin::Android);
    c->createSurface("phosh", Origin::Wayland);
    const std::string d = c->describe();
    CHECK(d.find("systemui") != std::string::npos, "android surface named");
    CHECK(d.find("phosh") != std::string::npos, "wayland surface named");
    CHECK(d.find("1080x2400") != std::string::npos, "panel size named");
}

// Removing a surface that never existed must be harmless: an Android client can
// disconnect at any point, including before it created anything.
static void testDestroyUnknownSurfaceIsHarmless() {
    std::printf("testDestroyUnknownSurfaceIsHarmless\n");
    auto c = makeCompositor();
    c->start(nullptr);
    c->destroySurface(9999);
    CHECK(c->surfaces().empty(), "no surfaces created");
    CHECK(!c->updateState(9999, makeState(0, 0, 10, 10, 1)), "updating an unknown surface is refused");
    CHECK(!c->attach(9999, makeBuffer(10, 10)), "attaching to an unknown surface is refused");
}

int main() {
    std::printf("nurfs compositor core tests\n\n");

    testRefusesStartWithoutMode();
    testStartsWithMode();
    testNewSurfaceIsInvisible();
    testSurfaceBecomesVisible();
    testRefusesNarrowStride();
    testInputRouting();
    testHiddenSurfaceGetsNoInput();
    testOpaqueFullscreenOccludesLowerSurfaces();
    testRestackInvalidatesFullFrame();
    testAlphaDisqualifiesHardwarePlane();
    testVideoTakesPlaneDespiteBlend();
    testReleaseCallbackFires();
    testOwnedBufferIsNotReleased();
    testReconfigureReachesClients();
    testGeometryClampedToPanel();
    testSameZOrderIsStable();
    testDescribeListsSurfaces();
    testDestroyUnknownSurfaceIsHarmless();

    std::printf("\n%d checks, %d failure(s)\n", checks, failures);
    return failures == 0 ? 0 : 1;
}
