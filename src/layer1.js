// 第一层：三维坐标轴 + 立方体单元格 + 内部剧本网络悬浮
// 每个有数据的格子内部包含一个精简的剧本网（3D 小球 + 连线）

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

function applySharedCubeView(state, camera, controls, target, defaultPosition) {
  const defaultDirection = defaultPosition.clone().sub(target).normalize();
  const savedDirection = Array.isArray(state?.cubeView?.direction)
    ? new THREE.Vector3(...state.cubeView.direction).normalize()
    : defaultDirection;
  const direction = savedDirection.lengthSq() > 0 ? savedDirection : defaultDirection;
  const distance = defaultPosition.distanceTo(target);
  controls.target.copy(target);
  camera.position.copy(target).add(direction.multiplyScalar(distance));
  camera.lookAt(target);
  controls.update();
}

function saveSharedCubeView(state, camera, controls) {
  if (!state) return;
  const direction = camera.position.clone().sub(controls.target).normalize();
  if (direction.lengthSq() === 0) return;
  state.cubeView = {
    direction: direction.toArray()
  };
}

export function renderLayer1({ app, model, state, helpers }) {
  const plays = model.plays || [];
  const cells = model.cubeCells || [];

  const totalPlays = plays.length;
  const genres = [...new Set(plays.map((p) => p.genre).filter(Boolean))];
  const colls = [...new Set(plays.map((p) => p.collection_id).filter(Boolean))];

  app.innerHTML = `
    <main class="page page--layer1">
      <div class="layer1-layout">
        <div class="layer1-kpi-col">
          <div class="kpi-card"><span class="kpi-num">${totalPlays}</span><span class="kpi-label">剧本</span></div>
          <div class="kpi-card"><span class="kpi-num">${colls.length}</span><span class="kpi-label">来源</span></div>
          <div class="kpi-card"><span class="kpi-num">${genres.length}</span><span class="kpi-label">类型</span></div>
          <div class="kpi-card"><span class="kpi-num">${cells.length}</span><span class="kpi-label">组合</span></div>
        </div>
        <div class="layer1-scene-wrap">
          <canvas id="cube-canvas"></canvas>
          <div class="layer1-hint">拖动旋转 · 滚轮缩放 · 点击坐标轴或轴标题进入第二层 · 点击格子进入第三层</div>
          <div class="layer1-tooltip" id="cube-tooltip" style="display:none"></div>
        </div>
      </div>
    </main>
  `;

  const canvas = document.querySelector("#cube-canvas");
  const wrap = canvas.parentElement;
  const tooltip = document.querySelector("#cube-tooltip");

  // --- Three.js ---
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(40, wrap.clientWidth / wrap.clientHeight, 1, 100);
  const defaultCameraPosition = new THREE.Vector3(16, 12, 16);
  const legacyLookAtTarget = new THREE.Vector3(5, 3, 3);
  camera.position.copy(defaultCameraPosition);
  camera.lookAt(legacyLookAtTarget);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(5, 3, 3);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 6;
  controls.maxDistance = 40;
  controls.update();

  // --- Lighting ---
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const dl = new THREE.DirectionalLight(0xffffff, 0.85);
  dl.position.set(10, 16, 8);
  scene.add(dl);

  // --- Axes ---
  const themes = [...new Set(cells.map((c) => c.theme))];
  const relations = [...new Set(cells.map((c) => c.relation))];
  const narratives = [...new Set(cells.map((c) => c.narrative))];

  const themeIdx = new Map(themes.map((t, i) => [t, i]));
  const relIdx = new Map(relations.map((r, i) => [r, i]));
  const narrIdx = new Map(narratives.map((n, i) => [n, i]));

  const maxCount = Math.max(...cells.map((c) => c.plays.length), 1);
  const origin = new THREE.Vector3(-0.5, -0.5, -0.5);
  const spacing = 1.8;
  const cellSize = 1.05;
  const axisPalette = {
    theme: 0xe8c06c,
    relation: 0xa8c6bb,
    narrative: 0xe1a476
  };

  const axisConfigs = {
    x: { vector: new THREE.Vector3(1, 0, 0), color: axisPalette.theme },
    y: { vector: new THREE.Vector3(0, 1, 0), color: axisPalette.narrative },
    z: { vector: new THREE.Vector3(0, 0, 1), color: axisPalette.relation }
  };
  const axisNameByDir = { x: "theme", y: "narrative", z: "relation" };
  const axisTargets = [];
  const yAxis = new THREE.Vector3(0, 1, 0);
  const zAxis = new THREE.Vector3(0, 0, 1);
  const tickGeo = new THREE.SphereGeometry(0.045, 12, 10);
  const cubeSize = new THREE.Vector3(
    Math.max(themes.length * spacing, 1),
    Math.max(narratives.length * spacing, 1),
    Math.max(relations.length * spacing, 1)
  );
  const cubeTarget = origin.clone().add(cubeSize.clone().multiplyScalar(0.5));
  cubeTarget.y += 0.45;
  const defaultCubeCameraPosition = cubeTarget.clone().add(
    defaultCameraPosition
      .clone()
      .sub(legacyLookAtTarget)
      .normalize()
      .multiplyScalar(defaultCameraPosition.distanceTo(legacyLookAtTarget))
  );
  applySharedCubeView(state, camera, controls, cubeTarget, defaultCubeCameraPosition);
  controls.addEventListener("change", () => saveSharedCubeView(state, camera, controls));

  function orientAlong(mesh, direction) {
    mesh.quaternion.setFromUnitVectors(yAxis, direction.clone().normalize());
  }

  function orientRingPerpendicularToAxis(mesh, direction) {
    mesh.quaternion.setFromUnitVectors(zAxis, direction.clone().normalize());
  }

  function addAxisBody(len, dir) {
    const { vector, color } = axisConfigs[dir];
    const axisGroup = new THREE.Group();
    const axisColor = new THREE.Color(color);
    const bodyGeo = new THREE.CylinderGeometry(0.018, 0.018, len, 16);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: axisColor,
      emissive: axisColor,
      emissiveIntensity: 0.1,
      roughness: 0.48,
      metalness: 0.08,
      transparent: true,
      opacity: 0.58
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.copy(vector.clone().multiplyScalar(len / 2));
    orientAlong(body, vector);
    axisGroup.add(body);

    const arrowGeo = new THREE.ConeGeometry(0.095, 0.32, 24);
    const arrowMat = new THREE.MeshStandardMaterial({
      color: axisColor,
      emissive: axisColor,
      emissiveIntensity: 0.18,
      roughness: 0.42,
      metalness: 0.08
    });
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.position.copy(vector.clone().multiplyScalar(len + 0.16));
    orientAlong(arrow, vector);
    axisGroup.add(arrow);

    const haloGeo = new THREE.RingGeometry(0.11, 0.135, 32);
    const haloMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.copy(vector.clone().multiplyScalar(len + 0.34));
    orientRingPerpendicularToAxis(halo, vector);
    axisGroup.add(halo);

    const hitGeo = new THREE.CylinderGeometry(0.18, 0.18, len + 0.72, 12);
    const hitMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false
    });
    const hit = new THREE.Mesh(hitGeo, hitMat);
    hit.position.copy(vector.clone().multiplyScalar((len + 0.28) / 2));
    orientAlong(hit, vector);
    hit.userData.axis = axisNameByDir[dir];
    hit.userData.baseScale = hit.scale.clone();
    axisGroup.add(hit);
    axisTargets.push(hit);

    axisGroup.position.copy(origin);
    scene.add(axisGroup);
  }

  function addTicks(count, dir) {
    const { color } = axisConfigs[dir];
    const tickMat = new THREE.MeshStandardMaterial({
      color,
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.18,
      roughness: 0.52,
      metalness: 0.08
    });
    for (let i = 0; i < count; i++) {
      const off = (i + 0.5) * spacing;
      const tick = new THREE.Mesh(tickGeo, tickMat);
      if (dir === "x") tick.position.set(origin.x + off, origin.y, origin.z);
      else if (dir === "z") tick.position.set(origin.x, origin.y, origin.z + off);
      else tick.position.set(origin.x, origin.y + off, origin.z);
      scene.add(tick);
    }
  }
  function addPlaneGuide(width, height, plane, color = axisPalette.theme) {
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.045 });
    const guide = new THREE.Group();
    const lineCount = 5;
    for (let i = 0; i < lineCount; i++) {
      const ratio = lineCount === 1 ? 0 : i / (lineCount - 1);
      const a = ratio * width;
      const b = ratio * height;
      const horizontal = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, b),
        new THREE.Vector3(width, 0, b)
      ]);
      const vertical = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(a, 0, 0),
        new THREE.Vector3(a, 0, height)
      ]);
      guide.add(new THREE.Line(horizontal, material), new THREE.Line(vertical, material));
    }
    if (plane === "xy") guide.rotation.x = Math.PI / 2;
    if (plane === "yz") guide.rotation.z = Math.PI / 2;
    guide.position.copy(origin);
    scene.add(guide);
  }
  addAxisBody(themes.length * spacing, "x");
  addAxisBody(relations.length * spacing, "z");
  addAxisBody(narratives.length * spacing, "y");
  addTicks(themes.length, "x"); addTicks(relations.length, "z"); addTicks(narratives.length, "y");
  addPlaneGuide(themes.length * spacing, relations.length * spacing, "xz", axisPalette.theme);
  addPlaneGuide(themes.length * spacing, narratives.length * spacing, "xy", axisPalette.narrative);
  addPlaneGuide(relations.length * spacing, narratives.length * spacing, "yz", axisPalette.relation);

  // Label sprites
  function makeLabel(text, color = "rgba(248,231,194,0.76)", fontSize = 30, options = {}) {
    const c = document.createElement("canvas"); c.width = 420; c.height = 86;
    const ctx = c.getContext("2d");
    const weight = options.weight || 700;
    const family = '"Microsoft YaHei","PingFang SC",sans-serif';
    ctx.font = `${weight} ${fontSize}px ${family}`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    if (options.badge) {
      const metrics = ctx.measureText(text);
      const w = Math.min(356, Math.max(126, metrics.width + 46));
      const h = 42;
      const x = (c.width - w) / 2;
      const y = (c.height - h) / 2;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, y, w, h, 18);
      } else {
        const r = 18;
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
      }
      ctx.fillStyle = options.fill || "rgba(12,18,20,0.62)";
      ctx.fill();
      ctx.strokeStyle = options.stroke || "rgba(224,232,224,0.22)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.shadowColor = options.shadow || "rgba(0,0,0,0.18)";
    ctx.shadowBlur = options.badge ? 0 : 4;
    if (options.textStroke) {
      ctx.lineWidth = options.textStrokeWidth || 4;
      ctx.strokeStyle = options.textStroke;
      ctx.lineJoin = "round";
      ctx.strokeText(text, c.width / 2, c.height / 2 + 1);
    }
    ctx.fillStyle = color;
    ctx.fillText(text, c.width / 2, c.height / 2 + 1);
    const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat); sprite.scale.set(options.badge ? 2.35 : 2.0, options.badge ? 0.48 : 0.34, 1);
    return sprite;
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[char]));
  }
  const axisTitleTargets = axisTargets;
  themes.forEach((t, i) => { const l = makeLabel(t.length > 4 ? t.slice(0, 4)+"…" : t, "rgba(236,219,178,0.62)", 24, { weight: 500, textStroke: "rgba(0,0,0,0.72)", textStrokeWidth: 3 }); l.position.set(origin.x+(i+0.5)*spacing, origin.y-0.5, origin.z-0.3); scene.add(l); });
  relations.forEach((r, i) => { const l = makeLabel(r.length > 5 ? r.slice(0, 5)+"…" : r, "rgba(236,219,178,0.62)", 24, { weight: 500, textStroke: "rgba(0,0,0,0.72)", textStrokeWidth: 3 }); l.position.set(origin.x-0.3, origin.y-0.5, origin.z+(i+0.5)*spacing); scene.add(l); });
  narratives.forEach((n, i) => { const l = makeLabel(n.length > 5 ? n.slice(0, 4)+"…" : n, "rgba(236,219,178,0.62)", 24, { weight: 500, textStroke: "rgba(0,0,0,0.72)", textStrokeWidth: 3 }); l.position.set(origin.x-0.3, origin.y+(i+0.5)*spacing, origin.z-0.5); scene.add(l); });
  [
    { text: "主题", axis: "theme" },
    { text: "角色关系", axis: "relation" },
    { text: "叙事结构", axis: "narrative" }
  ].forEach((item, i) => {
    const txt = item.text;
    const titleColor = {
      theme: "rgba(248,231,194,0.96)",
      relation: "rgba(248,231,194,0.92)",
      narrative: "rgba(248,231,194,0.92)"
    }[item.axis];
    const titleStroke = {
      theme: "rgba(232,192,108,0.28)",
      relation: "rgba(168,198,187,0.25)",
      narrative: "rgba(225,164,118,0.25)"
    }[item.axis];
    const l = makeLabel(txt, titleColor, 34, {
      badge: false,
      weight: 700,
      stroke: titleStroke,
      fill: "rgba(9,14,16,0.48)",
      textStroke: "rgba(0,0,0,0.9)",
      textStrokeWidth: 4.8
    });
    const pos = [[themes.length*spacing+0.5, -0.3, -0.3], [-0.3, -0.3, relations.length*spacing+0.5], [-0.3, narratives.length*spacing+0.5, -0.3]];
    l.position.set(origin.x+pos[i][0], origin.y+pos[i][1], origin.z+pos[i][2]);
    l.userData.axis = item.axis;
    l.userData.baseScale = l.scale.clone();
    axisTitleTargets.push(l);
    scene.add(l);
  });

  // --- Colors by play genre ---
  const genrePalette = [
    0xd35f4d, 0xe0a63f, 0x58a55c, 0x4d91ba, 0x8a6cc4,
    0xc96da3, 0x6f9f8b, 0xc47a4a, 0x9d8b4f, 0x5b7fc2
  ];
  const genreColorCache = new Map();
  function genreColor(genre) {
    const key = genre || "类型待分析";
    if (!genreColorCache.has(key)) {
      genreColorCache.set(key, new THREE.Color(genrePalette[genreColorCache.size % genrePalette.length]));
    }
    return genreColorCache.get(key);
  }

  // Shared geometries for performance
  const sphereGeo = new THREE.SphereGeometry(1, 12, 10);
  const edgeMat = new THREE.LineBasicMaterial({
    color: 0xdac69b,
    transparent: true,
    opacity: 0.34,
    linewidth: 1.25
  });

  // --- Cells with internal networks ---
  const cellGroup = new THREE.Group();
  scene.add(cellGroup);

  const meshes = [];
  const cellMap = new Map(); // mesh → cell data

  cells.forEach((cell) => {
    const xi = themeIdx.get(cell.theme);
    const zi = relIdx.get(cell.relation);
    const yi = narrIdx.get(cell.narrative);
    if (xi === undefined || zi === undefined || yi === undefined) return;

    const count = cell.plays.length;
    const t = Math.log(count) / Math.log(maxCount);
    const h = Math.max(0.5, 0.15 + t * 0.55);
    const cellPos = new THREE.Vector3(
      origin.x + (xi + 0.5) * spacing,
      origin.y + (yi + 0.5) * spacing,
      origin.z + (zi + 0.5) * spacing
    );

    // --- Outer box (semi-transparent) ---
    const boxGeo = new THREE.BoxGeometry(cellSize, cellSize * h, cellSize);
    const r = 0.56 + (1 - t) * 0.28, g = 0.12 + t * 0.68, b = 0.16 + (1 - t) * 0.2;
    const boxMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(r, g, b), roughness: 0.5, metalness: 0.1,
      transparent: true, opacity: 0.12 + t * 0.15,
      depthWrite: false,
    });
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.copy(cellPos);
    box.renderOrder = -1;
    cellGroup.add(box);

    // Clickable proxy (same size, invisible, catches raycasts)
    const proxyMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const proxy = new THREE.Mesh(boxGeo.clone(), proxyMat);
    proxy.position.copy(cellPos);
    cellGroup.add(proxy);
    meshes.push(proxy);
    cellMap.set(proxy, cell);

    // --- Internal play network visualization ---
    const playNodes = [...cell.plays]
      .sort((a, b) => Number(b.page_count || 0) - Number(a.page_count || 0))
      .slice(0, 24);

    if (playNodes.length) {
      const netGroup = new THREE.Group();
      const half = cellSize * 0.35;
      const innerR = half * 0.7;
      const nodePositions = new Map();

      const sphereR = innerR * (playNodes.length <= 6 ? 0.72 : 0.88);
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < playNodes.length; i++) {
        if (playNodes.length === 1) {
          nodePositions.set(playNodes[i].play_id, new THREE.Vector3(0, 0, 0));
          continue;
        }
        const y = 1 - (i / (playNodes.length - 1)) * 2;
        const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = i * goldenAngle;
        nodePositions.set(playNodes[i].play_id, new THREE.Vector3(
          Math.cos(theta) * radiusAtY * sphereR,
          y * sphereR,
          Math.sin(theta) * radiusAtY * sphereR
        ));
      }

      // Edges connect plays that share source collection or story period within the same cell.
      const edgePairs = new Set();
      for (let i = 0; i < playNodes.length; i++) {
        for (let j = i + 1; j < playNodes.length; j++) {
          const a = playNodes[i], b = playNodes[j];
          const sameCollection = a.collection_id && a.collection_id === b.collection_id;
          const samePeriod = a.story_period && a.story_period === b.story_period;
          if (sameCollection || samePeriod) edgePairs.add(`${a.play_id}|${b.play_id}`);
        }
      }
      if (!edgePairs.size && playNodes.length > 1) {
        for (let i = 0; i < playNodes.length; i++) {
          edgePairs.add(`${playNodes[i].play_id}|${playNodes[(i + 1) % playNodes.length].play_id}`);
        }
      }

      const edgePts = [];
      for (const pair of edgePairs) {
        const [s, t] = pair.split("|");
        const a = nodePositions.get(s);
        const b = nodePositions.get(t);
        if (!a || !b) continue;
        edgePts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
      if (edgePts.length) {
        const edgeBuf = new THREE.BufferGeometry();
        edgeBuf.setAttribute("position", new THREE.Float32BufferAttribute(edgePts, 3));
        const edgeLine = new THREE.LineSegments(edgeBuf, edgeMat);
        netGroup.add(edgeLine);
      }

      // Draw nodes
      for (const play of playNodes) {
        const pos = nodePositions.get(play.play_id);
        const col = genreColor(play.genre);
        const radius = 0.024 + Math.min(Number(play.page_count || 1), 18) * 0.00135;
        const nodeMat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.1 });
        const sphere = new THREE.Mesh(sphereGeo, nodeMat);
        sphere.scale.setScalar(radius);
        sphere.position.copy(pos);
        netGroup.add(sphere);
      }

      netGroup.position.set(cellPos.x, cellPos.y, cellPos.z);
      netGroup.renderOrder = 1;
      // Random rotation for variety
      netGroup.rotation.set(Math.random() * 0.5, Math.random() * 0.5, Math.random() * 0.3);
      cellGroup.add(netGroup);
    }
  });

  // --- Interaction ---
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let hovered = null;
  let hoveredAxisTitle = null;
  const clickMoveThreshold = 6;
  let pointerDown = null;
  let suppressNextClick = false;

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const titleHits = raycaster.intersectObjects(axisTitleTargets);
    const hits = raycaster.intersectObjects(meshes);

    if (hoveredAxisTitle) {
      hoveredAxisTitle.scale.copy(hoveredAxisTitle.userData.baseScale);
      hoveredAxisTitle = null;
    }
    if (hovered) {
      hovered.material.opacity = 0;
      hovered = null;
      tooltip.style.display = "none";
    }
    if (titleHits.length) {
      hoveredAxisTitle = titleHits[0].object;
      hoveredAxisTitle.scale.copy(hoveredAxisTitle.userData.baseScale).multiplyScalar(1.12);
      canvas.style.cursor = "pointer";
    } else if (hits.length) {
      const m = hits[0].object;
      m.material.opacity = 0.15;
      hovered = m;
      const cell = cellMap.get(m);
      if (cell) {
        const playPreview = cell.plays
          .slice(0, 8)
          .map((play) => `<span>${escapeHtml(play.title || play.play_id)}</span>`)
          .join("");
        const remaining = Math.max(0, cell.plays.length - 8);
        tooltip.innerHTML = `
          <div class="tt-triad" aria-label="主题、角色关系、叙事结构三维关系">
            <svg class="tt-triad-lines" viewBox="0 0 240 126" aria-hidden="true">
              <line x1="120" y1="24" x2="50" y2="101"></line>
              <line x1="120" y1="24" x2="190" y2="101"></line>
              <line x1="50" y1="101" x2="190" y2="101"></line>
            </svg>
            <div class="tt-rel-node tt-rel-theme">
              <span>主题</span>
              <strong>${escapeHtml(cell.theme)}</strong>
            </div>
            <div class="tt-rel-node tt-rel-relation">
              <span>角色关系</span>
              <strong>${escapeHtml(cell.relation)}</strong>
            </div>
            <div class="tt-rel-node tt-rel-narrative">
              <span>叙事结构</span>
              <strong>${escapeHtml(cell.narrative)}</strong>
            </div>
          </div>
          <div class="tt-plays">
            <strong>${cell.plays.length} 个剧本节点</strong>
            <div>${playPreview}${remaining ? `<span>+${remaining}</span>` : ""}</div>
          </div>
          <div class="tt-enter">颜色表示剧本类型 · 点击进入该组合</div>
        `;
        tooltip.style.display = "block";
        tooltip.style.left = `${Math.min(e.clientX + 16, window.innerWidth - 292)}px`;
        tooltip.style.top = `${Math.max(8, Math.min(e.clientY - 10, window.innerHeight - 262))}px`;
      }
      canvas.style.cursor = "pointer";
    } else {
      canvas.style.cursor = "grab";
    }
  });

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    pointerDown = { x: e.clientX, y: e.clientY, dragged: false };
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!pointerDown) return;
    const dx = e.clientX - pointerDown.x;
    const dy = e.clientY - pointerDown.y;
    if (Math.hypot(dx, dy) > clickMoveThreshold) {
      pointerDown.dragged = true;
    }
  });

  canvas.addEventListener("pointerup", (e) => {
    if (e.button !== 0 || !pointerDown) return;
    suppressNextClick = pointerDown.dragged;
    pointerDown = null;
  });

  canvas.addEventListener("pointercancel", () => {
    pointerDown = null;
    suppressNextClick = true;
  });

  canvas.addEventListener("click", () => {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    if (hoveredAxisTitle?.userData.axis) {
      window.openLayer2Axis(hoveredAxisTitle.userData.axis);
      return;
    }
    if (hovered) {
      const cell = cellMap.get(hovered);
      if (cell && cell.plays?.length) {
        window.openLayer3Cube?.(cell.id);
      }
    }
  });

  // --- Resize ---
  window.addEventListener("resize", () => {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  });

  // --- Animation ---
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  controls.update();
  renderer.render(scene, camera);
  animate();
}
