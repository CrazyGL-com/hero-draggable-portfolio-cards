import { jsx as _jsx } from "react/jsx-runtime";
import * as React from 'react';
import * as THREE from 'three';
import { useHeroAnimationFrame, useHeroAssetGate, useStableSeed, createDeterministicRandom, } from '@crazygl/core';
const MAX_CARDS = 6;
// Default aspect (H/W) used while a screenshot texture is still loading.
// 1 / 1.78 ≈ 0.5618 — i.e. 16:9 in H/W form. The spec asks for 1.78 (W/H),
// which translates to a HEIGHT/WIDTH ratio of 1/1.78 since the geometry size
// formula is (cardScale, cardScale / aspectWH).
const DEFAULT_ASPECT_WH = 1.78;
/* ------------------------------------------------------------------------
   Procedural studio HDRI (equirect, 1024x512).

   Same recipe as hero-floating-metal-frame — vertical sky→floor gradient
   plus discrete radial softboxes. No horizontal continuous structure so
   the cards' rim reflections don't show stretched bands.
   ------------------------------------------------------------------------ */
function makeStudioEnv(keyHex, fillHex) {
    const W = 1024;
    const H = 512;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0.0, '#d8e1f0');
    sky.addColorStop(0.45, '#384258');
    sky.addColorStop(0.55, '#0e1320');
    sky.addColorStop(1.0, '#020409');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    const boxes = [
        { x: W * 0.22, y: H * 0.18, r: 240, core: '#ffffff', halo: keyHex },
        { x: W * 0.80, y: H * 0.24, r: 200, core: '#e6ecff', halo: fillHex },
        { x: W * 0.50, y: H * 0.08, r: 90, core: '#ffffff', halo: '#ffffff' },
        { x: W * 0.12, y: H * 0.35, r: 55, core: '#ffffff', halo: '#ffffff' },
        { x: W * 0.66, y: H * 0.32, r: 60, core: '#ffffff', halo: '#ffffff' },
        { x: W * 0.93, y: H * 0.42, r: 45, core: '#ffffff', halo: '#ffffff' },
        // Floor darkening pools.
        { x: W * 0.25, y: H * 0.92, r: 90, core: '#08080c', halo: '#02020400' },
        { x: W * 0.75, y: H * 0.94, r: 80, core: '#08080c', halo: '#02020400' },
    ];
    ctx.globalCompositeOperation = 'lighter';
    for (const b of boxes) {
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        g.addColorStop(0.0, b.core);
        g.addColorStop(0.4, b.halo);
        const fade = b.halo.length === 9 ? b.halo.slice(0, 7) + '00' : b.halo + '00';
        g.addColorStop(1.0, fade);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = 'source-over';
    return cv;
}
/* ------------------------------------------------------------------------
   Soft drop-shadow canvas. A radial gradient with a slight downward bias,
   used under each card to fake a contact shadow.
   ------------------------------------------------------------------------ */
function makeCardShadow() {
    const W = 512;
    const H = 384;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H * 0.55; // a touch below centre — shadow falls down/right
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(W, H) * 0.55);
    g.addColorStop(0.0, 'rgba(0,0,0,0.85)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.45)');
    g.addColorStop(1.0, 'rgba(0,0,0,0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    return cv;
}
/* ------------------------------------------------------------------------
   Edge-glow canvas: a soft border around a rounded rectangle that fades
   outward. Applied to a BackSide plane behind the top card so we only see
   the glow extending past the card's edges, never over its face.
   ------------------------------------------------------------------------ */
function makeEdgeGlow(hex) {
    const W = 512;
    const H = 384;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    // Draw a rounded rect, blur it heavily, then "punch out" the centre so
    // only the outer halo remains.
    const r = Math.min(W, H) * 0.08;
    const padX = W * 0.07;
    const padY = H * 0.07;
    // Wide blurred border via multi-pass radial sweep.
    ctx.filter = 'blur(28px)';
    ctx.fillStyle = hex;
    const rx = W - 2 * padX;
    const ry = H - 2 * padY;
    const x = padX;
    const y = padY;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + rx - r, y);
    ctx.quadraticCurveTo(x + rx, y, x + rx, y + r);
    ctx.lineTo(x + rx, y + ry - r);
    ctx.quadraticCurveTo(x + rx, y + ry, x + rx - r, y + ry);
    ctx.lineTo(x + r, y + ry);
    ctx.quadraticCurveTo(x, y + ry, x, y + ry - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
    ctx.filter = 'none';
    return cv;
}
/* ------------------------------------------------------------------------
   Build a rounded-rectangle plane geometry.

   The geometry is unit-width (w=1) and h=aspectHW (HEIGHT / WIDTH ratio),
   so the caller scales the whole card by cardSize on X and cardSize on Y
   directly — the actual world rect ends up cardSize wide × cardSize*aspectHW
   tall. cornerRadius is in 0..0.5 (fraction of the short side).

   We build a NEW geometry per card now because each card carries its own
   intrinsic aspect from the loaded texture. (Cheap — one ShapeGeometry per
   card; <= MAX_CARDS = 6 of them.)
   ------------------------------------------------------------------------ */
function buildRoundedRect(aspectHW, cornerRadius, segments = 8) {
    const w = 1;
    const h = aspectHW;
    const halfW = w / 2;
    const halfH = h / 2;
    const shortSide = Math.min(w, h);
    const r = Math.max(0.0001, Math.min(cornerRadius * shortSide, shortSide * 0.49));
    const shape = new THREE.Shape();
    shape.moveTo(-halfW + r, -halfH);
    shape.lineTo(halfW - r, -halfH);
    shape.absarc(halfW - r, -halfH + r, r, -Math.PI / 2, 0, false);
    shape.lineTo(halfW, halfH - r);
    shape.absarc(halfW - r, halfH - r, r, 0, Math.PI / 2, false);
    shape.lineTo(-halfW + r, halfH);
    shape.absarc(-halfW + r, halfH - r, r, Math.PI / 2, Math.PI, false);
    shape.lineTo(-halfW, -halfH + r);
    shape.absarc(-halfW + r, -halfH + r, r, Math.PI, 1.5 * Math.PI, false);
    const geom = new THREE.ShapeGeometry(shape, segments);
    // Generate UVs that span [0..1] across the rectangle (ShapeGeometry's
    // default UVs are in shape-space, which for our [-0.5..0.5]x[-h/2..h/2]
    // rect needs to be remapped to [0..1]x[0..1] before the screenshot
    // texture will land correctly).
    const pos = geom.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        uvs[i * 2] = (x + halfW) / w; // u
        // Top of geometry (highest Y) → v=1 (top of texture). Textures default
        // to flipY=true so image's top row maps to v=1; this leaves screenshots
        // reading top-down on the card (heading at top, content below).
        uvs[i * 2 + 1] = (y + halfH) / h; // v
    }
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.computeVertexNormals();
    return geom;
}
function buildScatteredPoses(count, seed) {
    const rng = createDeterministicRandom(seed);
    const poses = [];
    const X_MIN = -2.0;
    const X_MAX = 2.0;
    const Y_MIN = -1.0;
    const Y_MAX = 1.0;
    const MIN_DIST = 0.7;
    const MAX_ATTEMPTS = 60;
    for (let k = 0; k < count; k++) {
        let x = 0;
        let y = 0;
        let placed = false;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            x = rng.range(X_MIN, X_MAX);
            y = rng.range(Y_MIN, Y_MAX);
            let ok = true;
            for (let j = 0; j < poses.length; j++) {
                const dx = poses[j].x - x;
                const dy = poses[j].y - y;
                if (dx * dx + dy * dy < MIN_DIST * MIN_DIST) {
                    ok = false;
                    break;
                }
            }
            if (ok) {
                placed = true;
                break;
            }
        }
        if (!placed) {
            // Fall back to a deterministic grid jitter — guarantees a finite
            // placement even if rejection sampling fails (e.g. count too high).
            const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
            const col = k % cols;
            const row = Math.floor(k / cols);
            x = X_MIN + ((col + 0.5) / cols) * (X_MAX - X_MIN) + rng.range(-0.15, 0.15);
            y = Y_MIN + ((row + 0.5) / cols) * (Y_MAX - Y_MIN) + rng.range(-0.15, 0.15);
        }
        const rotZ = rng.range(-Math.PI / 12, Math.PI / 12); // ±15°
        poses.push({
            x,
            y,
            // Small per-slot Z offset so cards never z-fight when their XY
            // happens to land close together.
            z: -k * 0.04,
            scale: 1.0,
            rotZ,
        });
    }
    return poses;
}
/* ------------------------------------------------------------------------
   Recompute geometry + pivot/mesh offsets for a card after its intrinsic
   aspectHW (HEIGHT/WIDTH) changes.

   Anchor P (in root-local units, which already include the cardSize scale)
   sits 30% inset from the bottom-left corner, INSIDE the card body:
        P = (-cardW * 0.3, -cardH * 0.3)
   where cardW = cardSize (card root-local width) and
         cardH = cardSize * aspectHW (card root-local height).

   To keep the visible card centered at root's origin when pivot.rotation.z
   = 0, we place pivot at P and the card mesh at -P (relative to pivot).
   ------------------------------------------------------------------------ */
function applyCardAspect(c, cardSize, cardCornerRadius) {
    const aspectHW = c.aspectHW;
    const cardW = cardSize;
    const cardH = cardSize * aspectHW;
    // Rebuild geometry to match the new aspect (the underlying unit rect is
    // 1×aspectHW; the mesh scale below is (cardSize, cardSize, 1) so world
    // dimensions become cardSize × cardSize*aspectHW).
    const newGeom = buildRoundedRect(aspectHW, cardCornerRadius, 12);
    const oldGeom = c.geom;
    c.geom = newGeom;
    c.card.geometry = newGeom;
    c.shadow.geometry = newGeom;
    if (c.glow)
        c.glow.geometry = newGeom;
    oldGeom.dispose();
    // Pivot at P (anchor). +X is right, +Y is up, so 30% inset from
    // bottom-left is negative X by 30% of cardW, negative Y by 30% of cardH.
    c.pivot.position.set(-cardW * 0.3, -cardH * 0.3, 0);
    // Card mesh offset = -P, so when pivot rotation is 0 the card visually
    // recentres at root's origin.
    c.card.position.set(cardW * 0.3, cardH * 0.3, 0);
    c.card.scale.set(cardW, cardW, 1);
    // Shadow stays a touch larger and offset down/right for the contact
    // shadow look. Sits as a child of root (NOT pivot) so it doesn't track
    // the flip rotation — keeps the shadow on the ground plane while the
    // card swings up.
    c.shadow.scale.set(cardW * 1.12, cardW * 1.18, 1);
    c.shadow.position.set(0.025 * cardW, -0.02 * cardW, -0.015);
    if (c.glow) {
        c.glow.scale.set(cardW * 1.16, cardW * 1.20, 1);
        c.glow.position.set(0, 0, -0.01);
    }
}
export default function StackStage(props) {
    const { rootRef, size, input, seed: seedInput, reducedMotion, screenshots, cardCount, cardSize, groupOffsetX, groupOffsetY, cardCornerRadius, cursorTilt, ambientFloat, edgeGlowColor, edgeGlowStrength, shadowStrength, keyColor, fillColor, screenBrightness, } = props;
    const stableSeed = useStableSeed(seedInput);
    const [assetReady, setAssetReady] = React.useState(false);
    useHeroAssetGate(assetReady);
    const canvasRef = React.useRef(null);
    const rendererRef = React.useRef(null);
    const sceneRef = React.useRef(null);
    const cameraRef = React.useRef(null);
    const stackGroupRef = React.useRef(null);
    const cardsRef = React.useRef([]);
    const shadowTexRef = React.useRef(null);
    const glowTexRef = React.useRef(null);
    const envRTRef = React.useRef(null);
    const pmremRef = React.useRef(null);
    const keyLightRef = React.useRef(null);
    const fillLightRef = React.useRef(null);
    const yawRef = React.useRef(0);
    const pitchRef = React.useRef(0);
    const screenTexturesRef = React.useRef([]);
    const screenAspectsRef = React.useRef([]); // per-slot aspectHW
    const envLoadedRef = React.useRef(false);
    const startMsRef = React.useRef(0);
    const elapsedRef = React.useRef(0);
    // Scattered rest poses — one per card slot. Deterministic from the stable
    // seed so the layout is stable across reloads but feels organic.
    const restPosesRef = React.useRef([]);
    const N_CLAMPED = Math.max(2, Math.min(MAX_CARDS, Math.round(cardCount)));
    const restPoses = React.useMemo(() => buildScatteredPoses(N_CLAMPED, stableSeed), [N_CLAMPED, stableSeed]);
    restPosesRef.current = restPoses;
    // Active drag state — which card is being dragged, by which pointer.
    // On pointerdown we raycast against the card meshes to find the front-most
    // hit, capture the pointer, and record the offset from the pointer's world
    // position to the card's stack-group-local origin. On pointermove we
    // update that card's dragOffsetX/Y so its rest pose is translated to put
    // its origin under the cursor (offset preserved). On pointerup we release.
    const dragPointerIdRef = React.useRef(null);
    const dragCardIndexRef = React.useRef(null);
    const dragMovedRef = React.useRef(false);
    const dragStartClientRef = React.useRef({ x: 0, y: 0 });
    // World-position offset = (card's stack-local origin) - (pointer world hit).
    // While dragging: card.dragOffset = pointerWorld + grabOffset - restPose.
    const dragGrabOffsetRef = React.useRef({ x: 0, y: 0 });
    // Which card the pointer is currently hovering (front-most under cursor).
    // -1 ⇒ none. Used both to set the cursor and to drive the hover-pop spring.
    const hoverCardIndexRef = React.useRef(-1);
    // Reusable raycaster + NDC vec to avoid per-event allocations.
    const raycasterRef = React.useRef(new THREE.Raycaster());
    const ndcRef = React.useRef(new THREE.Vector2());
    // One-time renderer + scene + lights + PMREM.
    React.useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas)
            return;
        const renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: true,
            premultipliedAlpha: false,
            powerPreference: 'high-performance',
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.setClearColor(0x000000, 0);
        rendererRef.current = renderer;
        const scene = new THREE.Scene();
        scene.background = null;
        sceneRef.current = scene;
        const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
        camera.position.set(0, 0.05, 5.0);
        camera.lookAt(0, 0, 0);
        cameraRef.current = camera;
        const key = new THREE.DirectionalLight(new THREE.Color(keyColor), 1.1);
        key.position.set(-2.0, 2.4, 4.0);
        scene.add(key);
        keyLightRef.current = key;
        const fill = new THREE.DirectionalLight(new THREE.Color(fillColor), 0.45);
        fill.position.set(2.2, -1.5, 3.0);
        scene.add(fill);
        fillLightRef.current = fill;
        const hemi = new THREE.HemisphereLight(0xc6d2e6, 0x10131c, 0.45);
        scene.add(hemi);
        const stack = new THREE.Group();
        scene.add(stack);
        stackGroupRef.current = stack;
        // Shared shadow + glow textures, built once.
        const shCv = makeCardShadow();
        const shTex = new THREE.CanvasTexture(shCv);
        shTex.colorSpace = THREE.SRGBColorSpace;
        shTex.minFilter = THREE.LinearFilter;
        shTex.magFilter = THREE.LinearFilter;
        shTex.generateMipmaps = false;
        shadowTexRef.current = shTex;
        const glCv = makeEdgeGlow(edgeGlowColor);
        const glTex = new THREE.CanvasTexture(glCv);
        glTex.colorSpace = THREE.SRGBColorSpace;
        glTex.minFilter = THREE.LinearFilter;
        glTex.magFilter = THREE.LinearFilter;
        glTex.generateMipmaps = false;
        glowTexRef.current = glTex;
        pmremRef.current = new THREE.PMREMGenerator(renderer);
        pmremRef.current.compileEquirectangularShader();
        startMsRef.current = performance.now();
        return () => {
            renderer.dispose();
            pmremRef.current?.dispose();
            pmremRef.current = null;
            envRTRef.current?.dispose();
            envRTRef.current = null;
            shadowTexRef.current?.dispose();
            shadowTexRef.current = null;
            glowTexRef.current?.dispose();
            glowTexRef.current = null;
            for (const t of screenTexturesRef.current)
                t?.dispose();
            screenTexturesRef.current = [];
            for (const c of cardsRef.current) {
                c.card.material.dispose();
                c.shadow.material.dispose();
                c.glow && c.glow.material.dispose();
                c.geom.dispose();
            }
            cardsRef.current = [];
            rendererRef.current = null;
            sceneRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // Resize.
    React.useEffect(() => {
        const renderer = rendererRef.current;
        const camera = cameraRef.current;
        if (!renderer || !camera)
            return;
        const w = Math.max(1, Math.floor(size.width));
        const h = Math.max(1, Math.floor(size.height));
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }, [size.width, size.height]);
    // HDRI rebuild on key/fill change.
    React.useEffect(() => {
        const renderer = rendererRef.current;
        const scene = sceneRef.current;
        const pmrem = pmremRef.current;
        if (!renderer || !scene || !pmrem)
            return;
        const cv = makeStudioEnv(keyColor, fillColor);
        const eqTex = new THREE.CanvasTexture(cv);
        eqTex.mapping = THREE.EquirectangularReflectionMapping;
        eqTex.colorSpace = THREE.SRGBColorSpace;
        const rt = pmrem.fromEquirectangular(eqTex);
        eqTex.dispose();
        envRTRef.current?.dispose();
        envRTRef.current = rt;
        scene.environment = rt.texture;
        envLoadedRef.current = true;
        for (const c of cardsRef.current) {
            c.mat.envMapIntensity = 0.5;
            c.mat.needsUpdate = true;
        }
    }, [keyColor, fillColor]);
    // Update light colors live.
    React.useEffect(() => {
        keyLightRef.current?.color.set(keyColor);
        fillLightRef.current?.color.set(fillColor);
    }, [keyColor, fillColor]);
    // Rebuild edge-glow texture when its color changes.
    React.useEffect(() => {
        const glCv = makeEdgeGlow(edgeGlowColor);
        const newTex = new THREE.CanvasTexture(glCv);
        newTex.colorSpace = THREE.SRGBColorSpace;
        newTex.minFilter = THREE.LinearFilter;
        newTex.magFilter = THREE.LinearFilter;
        newTex.generateMipmaps = false;
        glowTexRef.current?.dispose();
        glowTexRef.current = newTex;
        for (const c of cardsRef.current) {
            if (c.glow) {
                c.glow.material.map = newTex;
                c.glow.material.needsUpdate = true;
            }
        }
    }, [edgeGlowColor]);
    // Load all screenshot textures whenever the URL list changes. Each
    // texture exposes its intrinsic pixel size (image.width, image.height),
    // from which we derive the card's aspect (HEIGHT / WIDTH). On load we
    // stash the texture in the slot, push it into the matching card material,
    // AND rebuild that card's geometry / pivot offsets to match the new
    // aspect.
    React.useEffect(() => {
        const loader = new THREE.TextureLoader();
        loader.setCrossOrigin('anonymous');
        let cancelled = false;
        // Gate stays closed until every required texture has settled
        // (success OR error). Count the non-empty URLs up front; if there
        // is nothing to load, open the gate immediately.
        let remaining = screenshots.filter((url) => !!url).length;
        if (remaining === 0)
            setAssetReady(true);
        const settleOne = () => {
            remaining -= 1;
            if (remaining <= 0)
                setAssetReady(true);
        };
        screenshots.forEach((url, idx) => {
            if (!url)
                return;
            loader.load(url, (tex) => {
                if (cancelled) {
                    tex.dispose();
                    settleOne();
                    return;
                }
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.minFilter = THREE.LinearMipmapLinearFilter;
                tex.magFilter = THREE.LinearFilter;
                tex.generateMipmaps = true;
                tex.anisotropy = 8;
                tex.needsUpdate = true;
                // Replace old texture for this slot.
                screenTexturesRef.current[idx]?.dispose();
                screenTexturesRef.current[idx] = tex;
                // Intrinsic aspect (HEIGHT / WIDTH). The texture's `image` is
                // the HTMLImageElement/canvas with naturalWidth/Height.
                const img = tex.image;
                const iw = img?.naturalWidth || img?.width || 0;
                const ih = img?.naturalHeight || img?.height || 0;
                const aspectHW = (iw > 0 && ih > 0) ? (ih / iw) : (1 / DEFAULT_ASPECT_WH);
                screenAspectsRef.current[idx] = aspectHW;
                // Push the texture into the matching card material AND
                // rebuild that card's geometry to match its true aspect.
                const c = cardsRef.current[idx];
                if (c) {
                    c.mat.map = tex;
                    c.mat.emissiveMap = tex;
                    c.mat.color.set('#ffffff');
                    c.mat.needsUpdate = true;
                    c.aspectHW = aspectHW;
                    applyCardAspect(c, cardSize, cardCornerRadius);
                }
                settleOne();
            }, undefined, () => {
                // Failed load — leave the slot empty (card stays dark).
                settleOne();
            });
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [screenshots]);
    // Build (or rebuild) the card meshes. We rebuild when count / size /
    // corner radius changes. Aspect is now per-card (sourced from each
    // texture) and is applied via applyCardAspect() either at build time
    // (using the previously-loaded aspect, if any) or by the texture-loader
    // effect above when a screenshot finishes loading.
    React.useEffect(() => {
        const stack = stackGroupRef.current;
        const shadowTex = shadowTexRef.current;
        const glowTex = glowTexRef.current;
        if (!stack || !shadowTex || !glowTex)
            return;
        const n = Math.max(2, Math.min(MAX_CARDS, Math.round(cardCount)));
        // Tear down old.
        for (const c of cardsRef.current) {
            stack.remove(c.root);
            c.card.material.dispose();
            c.shadow.material.dispose();
            c.glow && c.glow.material.dispose();
            c.geom.dispose();
        }
        cardsRef.current = [];
        const initialPoses = restPosesRef.current;
        for (let i = 0; i < n; i++) {
            const root = new THREE.Group();
            // Initial pose comes from the scattered layout — random-feeling XY
            // inside a bounded area, ±15° rotation, and a tiny per-slot Z so
            // cards never z-fight.
            const pose = initialPoses[i] ?? { x: 0, y: 0, z: -i * 0.04, scale: 1, rotZ: 0 };
            root.position.set(pose.x, pose.y, pose.z);
            root.scale.setScalar(pose.scale);
            root.rotation.z = pose.rotZ;
            // Existing texture for this slot (may be null until the loader fires).
            const existing = screenTexturesRef.current[i] ?? null;
            const mat = new THREE.MeshStandardMaterial({
                color: existing ? new THREE.Color(0xffffff) : new THREE.Color(0x141821),
                map: existing,
                emissive: new THREE.Color(0xffffff),
                emissiveIntensity: screenBrightness,
                emissiveMap: existing,
                metalness: 0.0,
                roughness: 0.6,
                envMapIntensity: 0.5,
                side: THREE.DoubleSide,
            });
            // Per-card aspect: use the already-loaded value if we have one,
            // otherwise the default while we wait for the texture.
            const aspectHW = screenAspectsRef.current[i] ?? (1 / DEFAULT_ASPECT_WH);
            const geom = buildRoundedRect(aspectHW, cardCornerRadius, 12);
            // Pivot group: origin at the card's BL-interior anchor P =
            // (-cardW*0.3, -cardH*0.3) in root-local units (where cardW = cardSize,
            // cardH = cardSize*aspectHW). Rotating pivot.rotation.z spins the card
            // CCW about P (positive Z is CCW from the camera's POV looking down -Z).
            const pivot = new THREE.Group();
            root.add(pivot);
            const cardMesh = new THREE.Mesh(geom, mat);
            pivot.add(cardMesh);
            // Soft drop shadow — slightly larger than the card, behind it.
            // Sits on root (not pivot) so it stays on the ground plane while the
            // card swings up/over during the flip.
            const shadowMat = new THREE.MeshBasicMaterial({
                map: shadowTex,
                transparent: true,
                depthWrite: false,
                opacity: shadowStrength,
                color: new THREE.Color(0x000000),
            });
            const shadowMesh = new THREE.Mesh(geom, shadowMat);
            root.add(shadowMesh);
            // Edge glow — top card only. BackSide so we only see the halo that
            // extends past the card edges, not a colored rectangle over the
            // card face. The glow plane sits a touch behind the card so the
            // card itself obscures the centre.
            let glowMesh = null;
            if (i === 0) {
                const glowMat = new THREE.MeshBasicMaterial({
                    map: glowTex,
                    transparent: true,
                    depthWrite: false,
                    opacity: edgeGlowStrength,
                    blending: THREE.AdditiveBlending,
                    side: THREE.BackSide,
                });
                glowMesh = new THREE.Mesh(geom, glowMat);
                root.add(glowMesh);
            }
            stack.add(root);
            // Tag the card mesh with its index so the raycaster can recover
            // the CardEntry from the hit without a separate lookup table.
            cardMesh.userData.cardIndex = i;
            const entry = {
                root,
                pivot,
                card: cardMesh,
                shadow: shadowMesh,
                glow: glowMesh,
                mat,
                geom,
                aspectHW,
                dragOffsetX: 0,
                dragOffsetY: 0,
                dragging: false,
                hoverT: 0,
            };
            cardsRef.current.push(entry);
            // Apply pivot/mesh offsets for the initial aspect.
            applyCardAspect(entry, cardSize, cardCornerRadius);
        }
    }, [
        cardCount,
        restPoses,
        cardSize,
        cardCornerRadius,
        screenBrightness,
        shadowStrength,
        edgeGlowStrength,
    ]);
    // Live update — screen brightness / shadow / glow opacity without rebuilds.
    React.useEffect(() => {
        for (const c of cardsRef.current) {
            c.mat.emissiveIntensity = screenBrightness;
            c.shadow.material.opacity = shadowStrength;
            if (c.glow) {
                c.glow.material.opacity = edgeGlowStrength;
            }
        }
    }, [screenBrightness, shadowStrength, edgeGlowStrength]);
    React.useEffect(() => {
        const el = rootRef.current;
        if (!el)
            return;
        // ── Raycast helpers ────────────────────────────────────────────────
        // Convert a client (x, y) to normalised device coords against the
        // stage's bounding rect, then return both the NDC vector AND the
        // world hit point on the stack-group's local XY plane (z=0). Because
        // the stack group rotates with yaw/pitch, we have to undo that
        // transform to land in stack-LOCAL space — that's the coordinate
        // system the rest poses + dragOffsets live in.
        const clientToHit = (clientX, clientY) => {
            const camera = cameraRef.current;
            const stack = stackGroupRef.current;
            const cards = cardsRef.current;
            if (!camera || !stack)
                return null;
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0)
                return null;
            const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
            const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
            ndcRef.current.set(nx, ny);
            raycasterRef.current.setFromCamera(ndcRef.current, camera);
            // Intersect against card meshes only (front-to-back ordering matters
            // — three sorts hits by distance, so first hit = front-most card).
            const meshes = [];
            for (const c of cards)
                meshes.push(c.card);
            const hits = raycasterRef.current.intersectObjects(meshes, false);
            // Decide which card the cursor is over (front-most hit).
            let hitCardIndex = -1;
            if (hits.length > 0) {
                const h = hits[0];
                const idx = h.object.userData.cardIndex;
                if (typeof idx === 'number')
                    hitCardIndex = idx;
            }
            // World hit point on the stack-LOCAL XY plane (z=0 in stack local).
            // We transform the ray into stack-local space and intersect z=0
            // there directly — robust to the stack's yaw/pitch tilt.
            const localRay = new THREE.Ray().copy(raycasterRef.current.ray);
            const invStack = new THREE.Matrix4().copy(stack.matrixWorld).invert();
            localRay.applyMatrix4(invStack);
            // Plane z=0 in stack local. Parameter t along ray where z=0:
            //   origin.z + dir.z * t = 0 → t = -origin.z / dir.z
            if (Math.abs(localRay.direction.z) < 1e-6) {
                return { hitCardIndex, localX: 0, localY: 0 };
            }
            const t = -localRay.origin.z / localRay.direction.z;
            if (t < 0)
                return { hitCardIndex, localX: 0, localY: 0 };
            const localX = localRay.origin.x + localRay.direction.x * t;
            const localY = localRay.origin.y + localRay.direction.y * t;
            return { hitCardIndex, localX, localY };
        };
        const setCursor = (value) => {
            if (el.style.cursor !== value)
                el.style.cursor = value;
        };
        const onPointerMove = (event) => {
            const hit = clientToHit(event.clientX, event.clientY);
            // Drag update — if a card is actively being dragged by THIS pointer,
            // update its dragOffset so the card's stack-local origin sits at
            // (localX + grabOffset.x, localY + grabOffset.y). dragOffset is
            // relative to the card's REST pose, so we subtract it out below.
            const draggingIdx = dragCardIndexRef.current;
            if (draggingIdx !== null &&
                dragPointerIdRef.current === event.pointerId &&
                hit) {
                const card = cardsRef.current[draggingIdx];
                if (card) {
                    const restX = card.root.position.x - card.dragOffsetX;
                    const restY = card.root.position.y - card.dragOffsetY;
                    const wantX = hit.localX + dragGrabOffsetRef.current.x;
                    const wantY = hit.localY + dragGrabOffsetRef.current.y;
                    card.dragOffsetX = wantX - restX;
                    card.dragOffsetY = wantY - restY;
                }
                if (!dragMovedRef.current) {
                    const moved = Math.hypot(event.clientX - dragStartClientRef.current.x, event.clientY - dragStartClientRef.current.y);
                    dragMovedRef.current = moved > 6;
                }
                setCursor('grabbing');
                return;
            }
            // Hover update — pick the front-most card under cursor.
            const newHover = hit ? hit.hitCardIndex : -1;
            hoverCardIndexRef.current = newHover;
            setCursor(newHover >= 0 ? 'grab' : '');
        };
        const endDrag = (event) => {
            if (dragPointerIdRef.current !== event.pointerId)
                return;
            const draggingIdx = dragCardIndexRef.current;
            if (draggingIdx !== null) {
                const c = cardsRef.current[draggingIdx];
                if (c)
                    c.dragging = false;
            }
            dragPointerIdRef.current = null;
            dragCardIndexRef.current = null;
            // Update cursor to match whatever the pointer is over now.
            const hit = clientToHit(event.clientX, event.clientY);
            const newHover = hit ? hit.hitCardIndex : -1;
            hoverCardIndexRef.current = newHover;
            setCursor(newHover >= 0 ? 'grab' : '');
            try {
                el.releasePointerCapture(event.pointerId);
            }
            catch { /* ignore */ }
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', endDrag);
            window.removeEventListener('pointercancel', endDrag);
        };
        const onPointerDown = (event) => {
            const hit = clientToHit(event.clientX, event.clientY);
            if (!hit || hit.hitCardIndex < 0)
                return;
            const idx = hit.hitCardIndex;
            const card = cardsRef.current[idx];
            if (!card)
                return;
            // Card's current stack-local origin = root.position (excluding the
            // dragOffset already applied — but the offset IS the position
            // delta from rest, so the actual root.position already reflects
            // everything we need). We just record offset = (origin - hit).
            const originX = card.root.position.x;
            const originY = card.root.position.y;
            dragGrabOffsetRef.current = {
                x: originX - hit.localX,
                y: originY - hit.localY,
            };
            dragPointerIdRef.current = event.pointerId;
            dragCardIndexRef.current = idx;
            dragMovedRef.current = false;
            dragStartClientRef.current = { x: event.clientX, y: event.clientY };
            card.dragging = true;
            hoverCardIndexRef.current = idx;
            setCursor('grabbing');
            try {
                el.setPointerCapture(event.pointerId);
            }
            catch { /* ignore */ }
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', endDrag);
            window.addEventListener('pointercancel', endDrag);
        };
        const onPointerLeave = (event) => {
            // Only clear hover if no card is being dragged — the dragged card
            // stays "popped" until release even if the cursor leaves the bounds.
            if (dragCardIndexRef.current !== null)
                return;
            if (event && event.pointerId === dragPointerIdRef.current)
                return;
            hoverCardIndexRef.current = -1;
            setCursor('');
        };
        el.addEventListener('pointerdown', onPointerDown);
        el.addEventListener('pointermove', onPointerMove);
        el.addEventListener('pointerleave', onPointerLeave);
        return () => {
            el.removeEventListener('pointerdown', onPointerDown);
            el.removeEventListener('pointermove', onPointerMove);
            el.removeEventListener('pointerleave', onPointerLeave);
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', endDrag);
            window.removeEventListener('pointercancel', endDrag);
            el.style.cursor = '';
        };
    }, [rootRef]);
    useHeroAnimationFrame(rootRef, ({ delta }) => {
        const renderer = rendererRef.current;
        const scene = sceneRef.current;
        const camera = cameraRef.current;
        const stack = stackGroupRef.current;
        if (!renderer || !scene || !camera || !stack)
            return;
        const now = performance.now();
        if (!envLoadedRef.current && now - startMsRef.current < 1500) {
            renderer.setClearColor(0x000000, 0);
            renderer.clear();
            return;
        }
        const dt = reducedMotion ? 0 : Math.min(delta, 0.05);
        elapsedRef.current += dt;
        // Stack group sits at the static groupOffset — per-card drag now
        // translates individual card roots inside the group, not the whole
        // stack. Keeps rest poses / flip animations self-consistent.
        stack.position.x = groupOffsetX;
        stack.position.y = groupOffsetY;
        // Pointer parallax (±~8° yaw, ±~5° pitch at cursorTilt=1).
        // While a card is being dragged, FREEZE the tilt. clientToHit() maps the
        // cursor into stack-LOCAL space by inverting stack.matrixWorld; if the
        // tilt keeps easing toward the pointer each frame, that local frame
        // shifts between the discrete pointermove events that re-solve the drag
        // offset, so the dragged card visibly jitters. Holding yaw/pitch steady
        // during a drag keeps the stack-local mapping stable → smooth tracking.
        const isDragging = dragCardIndexRef.current !== null;
        const px = (input?.x ?? 0.5) * 2 - 1; // -1..1
        const py = (input?.y ?? 0.5) * 2 - 1;
        const targetYaw = isDragging ? yawRef.current : -px * (Math.PI / 22.5) * cursorTilt; // ±8° at cursorTilt=1
        const targetPitch = isDragging ? pitchRef.current : py * (Math.PI / 36) * cursorTilt; // ±5°
        // Exponential smoothing — frame-rate independent.
        const ease = 1 - Math.exp(-Math.max(0.001, delta) * 7.5);
        yawRef.current += (targetYaw - yawRef.current) * ease;
        pitchRef.current += (targetPitch - pitchRef.current) * ease;
        stack.rotation.y = yawRef.current;
        stack.rotation.x = pitchRef.current;
        const cards = cardsRef.current;
        const N = cards.length;
        const poses = restPosesRef.current;
        // Ambient float — gentle continuous bob of the whole stack so it never
        // reads as a static screenshot. Phase advances with elapsed time.
        // IMPORTANT: this is GLOBAL (applied to non-dragging cards only). The
        // dragged card never receives floatX/floatY so the only thing writing
        // to its position is the drag offset → no flicker from competing
        // animations.
        const floatY = ambientFloat * 0.025 * Math.sin(elapsedRef.current * 0.9);
        const floatX = ambientFloat * 0.018 * Math.sin(elapsedRef.current * 0.7 + 1.3);
        // ── Apply pose to every card ───────────────────────────────────────
        for (let i = 0; i < N; i++) {
            const card = cards[i];
            const pose = poses[i] ?? { x: 0, y: 0, z: -i * 0.04, scale: 1, rotZ: 0 };
            // ── Hover-pop spring ──────────────────────────────────────────
            // While dragging, lock hoverT to 1 immediately — no spring detection
            // (the cursor leaves/enters the hit region as the card moves under
            // it, which would otherwise toggle the target back to 0 every few
            // frames and produce a visible flicker on the pop scale + shadow).
            if (card.dragging) {
                card.hoverT = 1;
            }
            else {
                const targetHover = hoverCardIndexRef.current === i ? 1 : 0;
                const HOVER_TAU = 0.15; // seconds
                const hoverEase = 1 - Math.exp(-Math.max(0.001, delta) / HOVER_TAU);
                card.hoverT += (targetHover - card.hoverT) * hoverEase;
                if (card.hoverT < 0.0005 && targetHover === 0)
                    card.hoverT = 0;
            }
            // Scale = restScale * (1 + hoverT * 0.04). The popped card grows
            // 4% — enough to read as "lifted" without breaking the silhouette.
            const popScale = 1 + card.hoverT * 0.04;
            // Dragging a card pushes it slightly toward the camera so it
            // visually lifts above its neighbours.
            const dragLiftZ = card.dragging ? 0.18 : card.hoverT * 0.06;
            // While dragging, suppress ambient float — only the drag offset
            // writes to position. (Otherwise the float term keeps oscillating
            // each frame, fighting the drag write and producing a flicker.)
            const fx = card.dragging ? 0 : floatX;
            const fy = card.dragging ? 0 : floatY;
            card.root.position.x = pose.x + fx + card.dragOffsetX;
            card.root.position.y = pose.y + fy + card.dragOffsetY;
            card.root.position.z = pose.z + dragLiftZ;
            card.root.scale.setScalar(pose.scale * popScale);
            card.root.rotation.x = 0;
            card.root.rotation.y = 0;
            card.root.rotation.z = pose.rotZ;
            card.pivot.rotation.x = 0;
            card.pivot.rotation.z = 0;
            // Shadow lifts with hoverT — gets a touch darker AND grows.
            // Base opacity = shadowStrength (set elsewhere); we layer the pop
            // boost on top, capping at 1.0.
            const shadowMat = card.shadow.material;
            shadowMat.opacity = Math.min(1, shadowStrength + card.hoverT * 0.35);
            const cardW = cardSize;
            const shGrow = 1 + card.hoverT * 0.10; // shadow swells 10% when popped
            card.shadow.scale.set(cardW * 1.12 * shGrow, cardW * 1.18 * shGrow, 1);
            // Shadow drops further below the card while popped — fakes the
            // card lifting off the page.
            card.shadow.position.set(0.025 * cardW + card.hoverT * 0.02 * cardW, -0.02 * cardW - card.hoverT * 0.04 * cardW, -0.015);
        }
        renderer.render(scene, camera);
    });
    return (_jsx("canvas", { ref: canvasRef, className: "crazygl-cs-canvas", "aria-hidden": "true" }));
}
