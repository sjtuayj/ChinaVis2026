// 第二层：轴向总览
// 左上缩略立方体定位来源轴，右上展示对应轴的剧本总图。

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { sankey, sankeyJustify, sankeyLinkHorizontal } from "https://cdn.jsdelivr.net/npm/d3-sankey@0.12/+esm";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const AXIS_META = {
  theme: {
    label: "主题",
    title: "主题总图",
    field: "theme",
    color: "#e8c06c",
    secondary: "#a8c6bb",
    view: "theme"
  },
  relation: {
    label: "角色关系",
    title: "角色关系总图",
    field: "relation",
    color: "#a8c6bb",
    secondary: "#e1a476",
    view: "force"
  },
  narrative: {
    label: "叙事结构",
    title: "叙事结构总图",
    field: "narrative",
    color: "#e1a476",
    secondary: "#e8c06c",
    view: "force"
  }
};

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

export function renderLayer2({ app, model, state }) {
  const activeAxis = state.layer2Axis || "theme";
  const meta = AXIS_META[activeAxis] || AXIS_META.theme;

  app.innerHTML = `
    <main class="page page--layer2">
      <section class="layer2-grid layer-analysis-grid">
        <div class="card layer2-cube-card">
          <div class="slot">
            <div class="layer2-mini-cube-wrap">
              <canvas id="layer2-mini-cube" aria-label="第一层大立方体缩略总览"></canvas>
              <div id="layer2-mini-cube-tip" class="layer2-mini-cube-tip" style="display:none"></div>
              <div id="layer2-treemap-legend" class="layer2-treemap-legend"></div>
              <div class="layer2-axis-switch" aria-label="第二层视角切换">
                ${axisButton("theme", activeAxis)}
                ${axisButton("relation", activeAxis)}
                ${axisButton("narrative", activeAxis)}
              </div>
            </div>
          </div>
        </div>
        <div class="card layer2-overview-card">
          <div class="layer2-panel-title">
            <span>${meta.title}</span>
            <strong>完整总图；点击剧本进入第四层</strong>
          </div>
          <div class="slot">
            <svg id="layer2-axis-overview" class="layer2-overview-svg" viewBox="0 0 1720 520" preserveAspectRatio="xMidYMid meet"></svg>
          </div>
        </div>
        <div class="card layer2-sankey-card">
          <div class="layer2-side-title">
            <span>角色属性对应图</span>
            <strong>时期书签 / 题材 / 年龄 / 性别 / 社会身份 / 行当</strong>
          </div>
          <div class="slot">
            <svg id="layer2-role-sankey" class="layer2-sankey-svg" viewBox="0 0 2100 720" preserveAspectRatio="xMidYMid meet"></svg>
          </div>
        </div>
      </section>
      <button type="button" class="layer-back-button" onclick="backLayer2ToLayer1()" aria-label="返回第一层">
        <span class="layer-back-icon" aria-hidden="true"></span>
        <span class="layer-back-eyebrow">返回</span>
        <span class="layer-back-text">第一层立方体</span>
      </button>
    </main>
  `;

  renderMiniLayer1Cube(model, state, activeAxis);
  drawAxisOverview(d3.select("#layer2-axis-overview"), model, state, activeAxis, meta);
  drawRoleAttributeSankey(d3.select("#layer2-role-sankey"), model.roleTable || [], state);
}

function renderMiniLayer1Cube(model, state, activeAxis) {
  const canvas = document.querySelector("#layer2-mini-cube");
  const wrap = canvas?.parentElement;
  const tooltip = document.querySelector("#layer2-mini-cube-tip");
  const cells = model.cubeCells || [];
  if (!canvas || !wrap) return;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;

  const scene = new THREE.Scene();
  scene.background = null;
  const camera = new THREE.PerspectiveCamera(36, wrap.clientWidth / wrap.clientHeight, 0.1, 100);
  const defaultCameraPosition = new THREE.Vector3(17, 13.5, 17);
  camera.position.copy(defaultCameraPosition);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 8;
  controls.maxDistance = 38;

  scene.add(new THREE.AmbientLight(0xffffff, 0.58));
  const dl = new THREE.DirectionalLight(0xffffff, 0.88);
  dl.position.set(10, 16, 8);
  scene.add(dl);

  const themes = [...new Set(cells.map((c) => c.theme).filter(Boolean))];
  const relations = [...new Set(cells.map((c) => c.relation).filter(Boolean))];
  const narratives = [...new Set(cells.map((c) => c.narrative).filter(Boolean))];
  const themeIdx = new Map(themes.map((t, i) => [t, i]));
  const relIdx = new Map(relations.map((r, i) => [r, i]));
  const narrIdx = new Map(narratives.map((n, i) => [n, i]));
  const maxCount = Math.max(...cells.map((c) => c.plays?.length || 1), 1);
  const countLogBase = Math.max(Math.log(maxCount), 1);
  const origin = new THREE.Vector3(-0.5, -0.5, -0.5);
  const spacing = 1.35;
  const cellSize = 0.78;
  const axisPalette = { theme: 0xe8c06c, relation: 0xa8c6bb, narrative: 0xe1a476 };
  const axisConfigs = {
    x: { axis: "theme", vector: new THREE.Vector3(1, 0, 0), color: axisPalette.theme },
    y: { axis: "narrative", vector: new THREE.Vector3(0, 1, 0), color: axisPalette.narrative },
    z: { axis: "relation", vector: new THREE.Vector3(0, 0, 1), color: axisPalette.relation }
  };

  const size = new THREE.Vector3(
    Math.max(themes.length * spacing, 1),
    Math.max(narratives.length * spacing, 1),
    Math.max(relations.length * spacing, 1)
  );
  const target = origin.clone().add(size.clone().multiplyScalar(0.5));
  target.y += 0.45;
  applySharedCubeView(state, camera, controls, target, defaultCameraPosition);
  controls.addEventListener("change", () => saveSharedCubeView(state, camera, controls));

  const yAxis = new THREE.Vector3(0, 1, 0);
  function orientAlong(mesh, direction) {
    mesh.quaternion.setFromUnitVectors(yAxis, direction.clone().normalize());
  }

  function addAxisBody(len, dir) {
    const { axis, vector, color } = axisConfigs[dir];
    const active = axis === activeAxis;
    const axisGroup = new THREE.Group();
    const axisColor = new THREE.Color(color);
    const bodyGeo = new THREE.CylinderGeometry(active ? 0.028 : 0.015, active ? 0.028 : 0.015, len, 16);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: axisColor,
      emissive: axisColor,
      emissiveIntensity: active ? 0.28 : 0.09,
      roughness: 0.48,
      metalness: 0.08,
      transparent: true,
      opacity: active ? 0.94 : 0.42
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.copy(vector.clone().multiplyScalar(len / 2));
    orientAlong(body, vector);
    axisGroup.add(body);

    const arrowGeo = new THREE.ConeGeometry(active ? 0.13 : 0.08, active ? 0.34 : 0.25, 24);
    const arrowMat = new THREE.MeshStandardMaterial({
      color: axisColor,
      emissive: axisColor,
      emissiveIntensity: active ? 0.36 : 0.16,
      roughness: 0.42,
      metalness: 0.08
    });
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.position.copy(vector.clone().multiplyScalar(len + 0.12));
    orientAlong(arrow, vector);
    axisGroup.add(arrow);
    axisGroup.position.copy(origin);
    scene.add(axisGroup);
  }

  addAxisBody(themes.length * spacing, "x");
  addAxisBody(relations.length * spacing, "z");
  addAxisBody(narratives.length * spacing, "y");

  function makeLabel(text, axis, fontSize = 34) {
    const c = document.createElement("canvas");
    c.width = 420;
    c.height = 86;
    const ctx = c.getContext("2d");
    const active = axis === activeAxis;
    ctx.font = `${active ? 800 : 700} ${fontSize}px "Microsoft YaHei","PingFang SC",sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = active ? 5.4 : 4.2;
    ctx.strokeStyle = "rgba(0,0,0,0.9)";
    ctx.strokeText(text, c.width / 2, c.height / 2 + 1);
    ctx.fillStyle = active ? axisCssColor(axis) : "rgba(248,231,194,0.72)";
    ctx.fillText(text, c.width / 2, c.height / 2 + 1);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(active ? 2.05 : 1.75, active ? 0.42 : 0.34, 1);
    return sprite;
  }

  const axisTitleTargets = [
    { text: "主题", axis: "theme", pos: [themes.length * spacing + 0.45, -0.25, -0.25] },
    { text: "角色关系", axis: "relation", pos: [-0.25, -0.25, relations.length * spacing + 0.45] },
    { text: "叙事结构", axis: "narrative", pos: [-0.25, narratives.length * spacing + 0.45, -0.25] }
  ].map((item) => {
    const label = makeLabel(item.text, item.axis);
    label.position.set(origin.x + item.pos[0], origin.y + item.pos[1], origin.z + item.pos[2]);
    label.userData.axis = item.axis;
    scene.add(label);
    return label;
  });

  const meshes = [];
  const cellMap = new Map();
  const boxGeo = new THREE.BoxGeometry(cellSize, cellSize, cellSize);
  const proxyGeo = new THREE.BoxGeometry(cellSize * 1.04, cellSize * 1.04, cellSize * 1.04);

  for (const cell of cells) {
    const xi = themeIdx.get(cell.theme);
    const zi = relIdx.get(cell.relation);
    const yi = narrIdx.get(cell.narrative);
    if (xi === undefined || zi === undefined || yi === undefined) continue;
    const count = cell.plays?.length || 1;
    const t = Math.log(count) / countLogBase;
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.54 + (1 - t) * 0.26, 0.16 + t * 0.54, 0.18 + (1 - t) * 0.18),
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0,
      roughness: 0.5,
      metalness: 0.1,
      transparent: true,
      opacity: 0.14 + t * 0.13,
      depthWrite: false
    });
    const box = new THREE.Mesh(boxGeo, mat);
    box.scale.y = Math.max(0.52, 0.2 + t * 0.72);
    box.position.set(origin.x + (xi + 0.5) * spacing, origin.y + (yi + 0.5) * spacing, origin.z + (zi + 0.5) * spacing);
    scene.add(box);

    const edge = new THREE.EdgesGeometry(boxGeo);
    const edgeLine = new THREE.LineSegments(edge, new THREE.LineBasicMaterial({
      color: 0xdac69b,
      transparent: true,
      opacity: 0.2
    }));
    edgeLine.scale.copy(box.scale);
    edgeLine.position.copy(box.position);
    scene.add(edgeLine);

    const proxy = new THREE.Mesh(proxyGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    proxy.scale.copy(box.scale);
    proxy.position.copy(box.position);
    scene.add(proxy);
    meshes.push(proxy);
    cellMap.set(proxy, cell);
  }

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let hovered = null;
  let hoveredAxisTitle = null;
  let pointerDown = null;
  let suppressNextClick = false;
  const clickMoveThreshold = 6;

  function setMouse(event) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
  }

  canvas.addEventListener("mousemove", (event) => {
    setMouse(event);
    const titleHits = raycaster.intersectObjects(axisTitleTargets);
    const hits = raycaster.intersectObjects(meshes);
    hoveredAxisTitle = titleHits[0]?.object || null;
    hovered = hits[0]?.object || null;
    if (hovered) {
      const cell = cellMap.get(hovered);
      if (tooltip && cell) {
        tooltip.innerHTML = `<strong>${escapeHtml(cell.theme)}</strong><span>${escapeHtml(cell.relation)} / ${escapeHtml(cell.narrative)}</span><em>${cell.plays?.length || 0} 部剧本 · 点击进入第三层</em>`;
        tooltip.style.display = "block";
      }
      canvas.style.cursor = "pointer";
    } else {
      if (tooltip) tooltip.style.display = "none";
      canvas.style.cursor = hoveredAxisTitle ? "pointer" : "grab";
    }
  });

  canvas.addEventListener("mouseleave", () => {
    hovered = null;
    hoveredAxisTitle = null;
    if (tooltip) tooltip.style.display = "none";
  });

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pointerDown = { x: event.clientX, y: event.clientY, dragged: false };
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointerDown) return;
    if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > clickMoveThreshold) pointerDown.dragged = true;
  });
  canvas.addEventListener("pointerup", (event) => {
    if (event.button !== 0 || !pointerDown) return;
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
    const cell = hovered ? cellMap.get(hovered) : null;
    if (cell?.plays?.length) {
      window.openLayer3Cube?.(cell.id);
    }
  });

  const resize = () => {
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);

  let disposed = false;
  function animate() {
    if (!document.body.contains(canvas)) {
      disposed = true;
      window.removeEventListener("resize", resize);
      renderer.dispose();
      return;
    }
    controls.update();
    renderer.render(scene, camera);
    if (!disposed) requestAnimationFrame(animate);
  }
  animate();
}

function axisCssColor(axis) {
  return { theme: "rgba(232,192,108,0.98)", relation: "rgba(168,198,187,0.98)", narrative: "rgba(225,164,118,0.98)" }[axis] || "rgba(248,231,194,0.9)";
}

function axisButton(axis, activeAxis) {
  const meta = AXIS_META[axis];
  return `<button type="button" class="${axis === activeAxis ? "active" : ""}" style="--axis-color:${meta.color}" onclick="openLayer2Axis('${axis}')">${meta.label}</button>`;
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

function drawCubeOverview(svg, model, state, activeAxis, meta) {
  svg.selectAll("*").remove();
  const width = 520;
  const height = 420;
  const origin = [258, 278];
  const sx = 57;
  const sy = 44;
  const sz = 52;
  const themeValues = uniqueValues(model.cubeCells, "theme").slice(0, 5);
  const relationValues = uniqueValues(model.cubeCells, "relation").slice(0, 5);
  const narrativeValues = uniqueValues(model.cubeCells, "narrative").slice(0, 5);
  const maxCellCount = d3.max(model.cubeCells, (cell) => cell.plays?.length || 1) || 1;

  const xScale = ordinalIndex(themeValues);
  const yScale = ordinalIndex(narrativeValues);
  const zScale = ordinalIndex(relationValues);
  const extent = 4.2;

  const defs = svg.append("defs");
  const glow = defs.append("filter").attr("id", "layer2-axis-glow").attr("x", "-60%").attr("y", "-60%").attr("width", "220%").attr("height", "220%");
  glow.append("feGaussianBlur").attr("stdDeviation", 4).attr("result", "blur");
  glow.append("feMerge").selectAll("feMergeNode").data(["blur", "SourceGraphic"]).join("feMergeNode").attr("in", (d) => d);

  svg.append("path")
    .attr("class", "layer2-cube-shadow")
    .attr("d", `M${origin[0] - 190},${origin[1] + 92} C${origin[0] - 82},${origin[1] + 156} ${origin[0] + 128},${origin[1] + 148} ${origin[0] + 216},${origin[1] + 76}`);

  const lattice = svg.append("g").attr("class", "layer2-cube-lattice");
  drawCubeFrame(lattice, extent, project);
  drawMiniPlaneGuides(lattice, extent, project, activeAxis);
  const activePlane = axisPlane(activeAxis, extent, project);

  svg.append("polygon")
    .attr("class", `layer2-axis-plane layer2-axis-plane--${activeAxis}`)
    .attr("points", activePlane.map((p) => p.join(",")).join(" "))
    .attr("fill", meta.color)
    .attr("stroke", meta.color);

  drawAxisLine(lattice, origin, project(4.65, 0, 0), "主题", activeAxis === "theme", "#e8c06c");
  drawAxisLine(lattice, origin, project(0, 0, 4.65), "角色关系", activeAxis === "relation", "#a8c6bb");
  drawAxisLine(lattice, origin, project(0, 4.65, 0), "叙事结构", activeAxis === "narrative", "#e1a476");

  const nodes = model.cubeCells.slice(0, 90).map((cell) => {
    const x = xScale(cell.theme);
    const y = yScale(cell.narrative);
    const z = zScale(cell.relation);
    const [px, py] = project(x, y, z);
    const count = cell.plays?.length || 1;
    return { ...cell, px, py, count, size: 6 + Math.sqrt(count / maxCellCount) * 15 };
  }).sort((a, b) => a.py - b.py || a.px - b.px);

  svg.append("g").selectAll("rect")
    .data(nodes)
    .join("rect")
    .attr("class", (d) => ["layer2-cube-node", d.id === state.selectedCubeId ? "active" : ""].join(" "))
    .attr("x", (d) => d.px - d.size / 2)
    .attr("y", (d) => d.py - d.size / 2)
    .attr("width", (d) => d.size)
    .attr("height", (d) => d.size)
    .attr("rx", 2)
    .attr("transform", (d) => `rotate(45 ${d.px} ${d.py})`)
    .attr("fill", (d) => d.id === state.selectedCubeId ? meta.color : "rgba(236,219,178,0.42)")
    .append("title")
    .text((d) => `${d.theme}\n${d.relation}\n${d.narrative}\n${d.count} 部`);

  svg.append("text")
    .attr("class", "layer2-cube-caption")
    .attr("x", width / 2)
    .attr("y", height - 32)
    .attr("text-anchor", "middle")
    .text(`${meta.label}轴已高亮`);

  function project(x, y, z) {
    return [origin[0] + (x - y) * sx, origin[1] + (x + y) * sy * 0.48 - z * sz];
  }
}

function drawCubeFrame(group, extent, project) {
  const corners = [
    [0, 0, 0], [extent, 0, 0], [0, extent, 0], [0, 0, extent],
    [extent, extent, 0], [extent, 0, extent], [0, extent, extent], [extent, extent, extent]
  ];
  const edges = [
    [0, 1], [0, 2], [0, 3],
    [1, 4], [1, 5],
    [2, 4], [2, 6],
    [3, 5], [3, 6],
    [4, 7], [5, 7], [6, 7]
  ];
  group.append("g").attr("class", "layer2-cube-frame").selectAll("line")
    .data(edges)
    .join("line")
    .attr("x1", (d) => project(...corners[d[0]])[0])
    .attr("y1", (d) => project(...corners[d[0]])[1])
    .attr("x2", (d) => project(...corners[d[1]])[0])
    .attr("y2", (d) => project(...corners[d[1]])[1]);
}

function drawMiniPlaneGuides(group, extent, project, activeAxis) {
  const guideData = [
    { axis: "theme", color: "#e8c06c", lines: d3.range(1, 4).flatMap((i) => [[[i, 0, 0], [i, extent, 0]], [[i, 0, 0], [i, 0, extent]]]) },
    { axis: "narrative", color: "#e1a476", lines: d3.range(1, 4).flatMap((i) => [[[0, i, 0], [extent, i, 0]], [[0, i, 0], [0, i, extent]]]) },
    { axis: "relation", color: "#a8c6bb", lines: d3.range(1, 4).flatMap((i) => [[[0, 0, i], [extent, 0, i]], [[0, 0, i], [0, extent, i]]]) }
  ];
  for (const guide of guideData) {
    group.append("g")
      .attr("class", `layer2-plane-guide ${guide.axis === activeAxis ? "active" : ""}`)
      .attr("stroke", guide.color)
      .selectAll("line")
      .data(guide.lines)
      .join("line")
      .attr("x1", (d) => project(...d[0])[0])
      .attr("y1", (d) => project(...d[0])[1])
      .attr("x2", (d) => project(...d[1])[0])
      .attr("y2", (d) => project(...d[1])[1]);
  }
}

function axisPlane(axis, extent, project) {
  const mid = extent * 0.52;
  const points = {
    theme: [[mid, 0, 0], [mid, extent, 0], [mid, extent, extent], [mid, 0, extent]],
    narrative: [[0, mid, 0], [extent, mid, 0], [extent, mid, extent], [0, mid, extent]],
    relation: [[0, 0, mid], [extent, 0, mid], [extent, extent, mid], [0, extent, mid]]
  }[axis] || [[mid, 0, 0], [mid, extent, 0], [mid, extent, extent], [mid, 0, extent]];
  return points.map((point) => project(...point));
}

function drawAxisLine(group, origin, end, label, active, color) {
  group.append("line")
    .attr("class", `layer2-cube-axis ${active ? "active" : ""}`)
    .attr("x1", origin[0])
    .attr("y1", origin[1])
    .attr("x2", end[0])
    .attr("y2", end[1])
    .attr("stroke", color)
    .attr("filter", active ? "url(#layer2-axis-glow)" : null);

  group.append("text")
    .attr("class", `layer2-cube-axis-label ${active ? "active" : ""}`)
    .attr("x", end[0])
    .attr("y", end[1] - 10)
    .attr("text-anchor", "middle")
    .attr("fill", color)
    .text(label);
}

export function drawAxisOverview(svg, model, state, activeAxis, meta) {
  svg.selectAll("*").remove();
  svg.on(".zoom", null);
  if (!model.plays.length) {
    drawEmpty(svg, "数据加载中");
    return;
  }

  drawAxisTreemapOverview(svg, model, state, activeAxis, meta);
}

function drawAxisTreemapOverview(svg, model, state, activeAxis, meta) {
  const width = 1680;
  const height = 520;
  const fieldMeta = {
    theme: { key: "theme", label: "主题", color: "#e8c06c", value: (play) => play.theme || getPlayThemePath(play)[0] || "主题待分析" },
    relation: { key: "relation", label: "角色关系", color: "#a8c6bb", value: (play) => play.relation || play.y_relation?.label || "关系待分析" },
    narrative: { key: "narrative", label: "叙事结构", color: "#e1a476", value: (play) => play.narrative || play.z_narrative?.label || "叙事待分析" }
  };
  const selectedCell = state.layer === 3 && state.selectedCubeId ? model.cubeById?.get(state.selectedCubeId) : null;
  const selected = new Set((selectedCell?.plays || []).map((play) => play.play_id));
  const highlightedValue = selectedCell ? selectedCell[fieldMeta[activeAxis].key] : null;
  const order = [activeAxis];
  const palette = axisTreemapPalette(activeAxis);

  const rootData = {
    name: meta.title,
    children: buildAxisTreemapChildren(model.plays, activeAxis, fieldMeta)
  };
  const color = d3.scaleOrdinal(palette).domain(rootData.children.map((item) => item.name));
  const themeColorLookup = activeAxis === "theme" ? buildTreemapThemeColorLookup(rootData.children, color) : new Map();
  const root = d3.hierarchy(rootData)
    .sum((d) => d.play ? 1 : 0)
    .sort((a, b) => d3.descending(a.value, b.value));

  d3.treemap()
    .tile(d3.treemapSquarify.ratio(1))
    .size([width, height])
    .paddingOuter(activeAxis === "theme" ? 5 : 8)
    .paddingTop((d) => d.depth === 0 ? 14 : d.depth === 1 ? 18 : 1.2)
    .paddingInner((d) => d.depth <= 1 ? 5.5 : 1.4)
    .round(true)(root);

  const defs = svg.append("defs");
  const glow = defs.append("filter").attr("id", "layer2-treemap-glow").attr("x", "-30%").attr("y", "-30%").attr("width", "160%").attr("height", "160%");
  glow.append("feGaussianBlur").attr("stdDeviation", 2.6).attr("result", "blur");
  glow.append("feMerge").selectAll("feMergeNode").data(["blur", "SourceGraphic"]).join("feMergeNode").attr("in", (d) => d);
  defineTreemapPlayGradients(defs, root.leaves().filter((d) => d.data.play), activeAxis, fieldMeta, themeColorLookup, color);

  const tile = svg.append("g")
    .selectAll("g")
    .data(root.descendants().filter((d) => d.depth > 0))
    .join("g")
    .attr("class", (d) => {
      const highlighted = isTreemapHighlighted(d, highlightedValue, activeAxis, fieldMeta, selected);
      const dimmed = highlightedValue && !highlighted;
      return [
        "layer2-treemap-tile",
        `depth-${d.depth}`,
        d.data.play ? "leaf" : "branch",
        highlighted ? "highlighted" : "",
        dimmed ? "dimmed" : "",
        d.data.play && selected.has(d.data.play.play_id) ? "selected" : ""
      ].join(" ");
    })
    .attr("transform", (d) => `translate(${d.x0},${d.y0})`);

  tile.append("rect")
    .attr("width", (d) => Math.max(0, d.x1 - d.x0))
    .attr("height", (d) => Math.max(0, d.y1 - d.y0))
    .attr("rx", (d) => d.data.play ? 6 : 8)
    .attr("ry", (d) => d.data.play ? 6 : 8)
    .attr("fill", (d) => treemapFill(d, color, fieldMeta, order, activeAxis))
    .attr("fill-opacity", (d) => {
      const highlighted = isTreemapHighlighted(d, highlightedValue, activeAxis, fieldMeta, selected);
      if (highlightedValue && !highlighted) return d.data.play ? 0.24 : 0.12;
      if (highlighted) return d.data.play ? 0.94 : 0.52;
      if (d.data.play) return activeAxis === "theme" ? 0.84 : 0.66;
      return d.depth === 1 ? 0.36 : 0.28;
    })
    .on("mouseenter", function (event, d) {
      if (d.data.play) d3.select(this.parentNode).raise();
      d3.select(this).attr("stroke", "rgba(248,231,194,0.96)").attr("stroke-width", d.data.play ? 1.6 : 1.1);
      if (d.data.play) showTreemapTooltip(svg, d, event, fieldMeta, order, width, height);
    })
    .on("mousemove", (event, d) => {
      if (d.data.play) showTreemapTooltip(svg, d, event, fieldMeta, order, width, height);
    })
    .on("mouseleave", function (event, d) {
      d3.select(this).attr("stroke", null).attr("stroke-width", null);
      if (d.data.play) svg.select(".layer2-treemap-tooltip").style("display", "none");
    })
    .on("click", (event, d) => {
      event.stopPropagation();
      if (d.data.play?.play_id) {
        if (state.layer === 3) window.openLayer3Play?.(d.data.play.play_id, activeAxis);
        else window.openPlay(d.data.play.play_id);
      }
    });

  tile.filter((d) => isTreemapHighlighted(d, highlightedValue, activeAxis, fieldMeta, selected)).raise();

  drawTreemapLegend(svg, rootData.children, color, activeAxis, fieldMeta, width);

  svg.append("text")
    .attr("class", "theme-tree-note")
    .attr("x", width - 26)
    .attr("y", height - 20)
    .attr("text-anchor", "end")
    .text(highlightedValue ? `${model.plays.length} 部剧本 · 高亮：${highlightedValue}` : `${model.plays.length} 部剧本`);

  const tooltip = svg.append("g").attr("class", "layer2-treemap-tooltip theme-leaf-tooltip").style("display", "none");
  tooltip.append("rect").attr("rx", 6).attr("ry", 6);
  tooltip.append("text").attr("class", "tooltip-title").attr("x", 10).attr("y", 8);
  tooltip.append("text").attr("class", "tooltip-theme").attr("x", 10).attr("y", 30);
  tooltip.append("text").attr("class", "tooltip-theme tooltip-meta").attr("x", 10).attr("y", 49);
}

function isTreemapHighlighted(d, highlightedValue, activeAxis, fieldMeta, selectedPlayIds) {
  if (!highlightedValue) return false;
  if (d.data.play) {
    return selectedPlayIds.has(d.data.play.play_id) || fieldMeta[activeAxis].value(d.data.play) === highlightedValue;
  }
  return d.leaves?.().some((leaf) => leaf.data.play && fieldMeta[activeAxis].value(leaf.data.play) === highlightedValue);
}

function drawAxisParticleOverview(svg, model, state, activeAxis, meta, fieldMeta, rootData, color, width, height) {
  const otherAxis = activeAxis === "relation" ? "narrative" : "relation";
  const selectedCubeId = state.selectedCubeId;
  const themeValues = topValues(model.plays, (play) => fieldMeta.theme.value(play), 14);
  const otherValues = topValues(model.plays, (play) => fieldMeta[otherAxis].value(play), 12);
  const themeColor = d3.scaleOrdinal(d3.schemeTableau10).domain([...themeValues]);
  const otherColor = d3.scaleOrdinal(axisTreemapPalette(otherAxis)).domain([...otherValues]);
  const groups = rootData.children.map((group) => ({
    name: group.name,
    plays: (group.children || []).map((child) => child.play).filter(Boolean)
  })).filter((group) => group.plays.length);

  const groupRoot = d3.hierarchy({ children: groups })
    .sum((d) => d.plays?.length || 0)
    .sort((a, b) => d3.descending(a.value, b.value));
  d3.treemap()
    .tile(d3.treemapSquarify.ratio(1.28))
    .size([width, height])
    .paddingOuter(8)
    .paddingTop(28)
    .paddingInner(8)
    .round(true)(groupRoot);

  const defs = svg.append("defs");
  const glow = defs.append("filter").attr("id", "layer2-particle-glow").attr("x", "-80%").attr("y", "-80%").attr("width", "260%").attr("height", "260%");
  glow.append("feGaussianBlur").attr("stdDeviation", 2.4).attr("result", "blur");
  glow.append("feMerge").selectAll("feMergeNode").data(["blur", "SourceGraphic"]).join("feMergeNode").attr("in", (d) => d);

  const panels = svg.append("g")
    .selectAll("g")
    .data(groupRoot.leaves())
    .join("g")
    .attr("class", "layer2-particle-panel")
    .attr("transform", (d) => `translate(${d.x0},${d.y0})`);

  panels.append("rect")
    .attr("class", "layer2-particle-panel-bg")
    .attr("width", (d) => Math.max(0, d.x1 - d.x0))
    .attr("height", (d) => Math.max(0, d.y1 - d.y0))
    .attr("rx", 9)
    .attr("fill", (d) => {
      return softenColor(color(d.data.name), 0.08, 0.46);
    })
    .attr("stroke", (d) => color(d.data.name));

  panels.append("text")
    .attr("class", "layer2-particle-panel-title")
    .attr("x", 12)
    .attr("y", 18)
    .text((d) => `${shortLabel(d.data.name, 11)} ${d.data.plays.length}`);

  const particles = [];
  for (const panel of groupRoot.leaves()) {
    particles.push(...layoutParticles(panel, activeAxis, fieldMeta, themeColor, otherColor, selectedCubeId));
  }

  const particle = svg.append("g")
    .attr("class", "layer2-particle-layer")
    .selectAll("rect")
    .data(particles)
    .join("rect")
    .attr("class", (d) => `layer2-play-particle ${d.selected ? "selected" : ""}`)
    .attr("x", (d) => d.x)
    .attr("y", (d) => d.y)
    .attr("width", (d) => d.size)
    .attr("height", (d) => d.size)
    .attr("rx", (d) => Math.max(2.4, d.size * 0.42))
    .attr("ry", (d) => Math.max(2.4, d.size * 0.42))
    .attr("fill", (d) => d.fill)
    .attr("stroke", (d) => d.stroke)
    .attr("stroke-width", (d) => d.selected ? 2.4 : 0.9)
    .attr("opacity", (d) => d.selected ? 0.96 : 0.62)
    .attr("filter", (d) => d.selected ? "url(#layer2-particle-glow)" : null)
    .on("mouseenter", function (event, d) {
      particle
        .classed("related", (p) => p.play.theme === d.play.theme || p.play.relation === d.play.relation || p.play.narrative === d.play.narrative)
        .classed("unrelated", (p) => !(p.play.theme === d.play.theme || p.play.relation === d.play.relation || p.play.narrative === d.play.narrative));
      d3.select(this).raise().attr("opacity", 0.98).attr("stroke-width", 2.4);
      showTreemapTooltip(svg, { data: { play: d.play } }, event, fieldMeta, [activeAxis], width, height);
    })
    .on("mousemove", (event, d) => showTreemapTooltip(svg, { data: { play: d.play } }, event, fieldMeta, [activeAxis], width, height))
    .on("mouseleave", function () {
      particle.classed("related", false).classed("unrelated", false);
      d3.select(this).attr("opacity", (d) => d.selected ? 0.96 : 0.62).attr("stroke-width", (d) => d.selected ? 2.4 : 0.9);
      svg.select(".layer2-treemap-tooltip").style("display", "none");
    })
    .on("click", (event, d) => {
      event.stopPropagation();
      if (state.layer === 3) window.openLayer3Play?.(d.play.play_id, activeAxis);
      else window.openPlay(d.play.play_id);
    });

  drawParticleLegend(svg, fieldMeta, activeAxis, themeColor, otherColor, themeValues, otherValues, width);

  svg.append("text")
    .attr("class", "theme-tree-note")
    .attr("x", width - 26)
    .attr("y", height - 20)
    .attr("text-anchor", "end")
    .text(`${model.plays.length} 部剧本 · 填充=主题 · 描边=${fieldMeta[otherAxis].label}`);

  const tooltip = svg.append("g").attr("class", "layer2-treemap-tooltip theme-leaf-tooltip").style("display", "none");
  tooltip.append("rect").attr("rx", 6).attr("ry", 6);
  tooltip.append("text").attr("class", "tooltip-title").attr("x", 10).attr("y", 8);
  tooltip.append("text").attr("class", "tooltip-theme").attr("x", 10).attr("y", 30);
  tooltip.append("text").attr("class", "tooltip-theme tooltip-meta").attr("x", 10).attr("y", 49);
}

function layoutParticles(panel, activeAxis, fieldMeta, themeColor, otherColor, selectedCubeId) {
  const width = Math.max(1, panel.x1 - panel.x0);
  const height = Math.max(1, panel.y1 - panel.y0);
  const plays = panel.data.plays;
  const padding = 12;
  const top = 32;
  const availableW = Math.max(1, width - padding * 2);
  const availableH = Math.max(1, height - top - padding);
  const columns = Math.max(1, Math.ceil(Math.sqrt((plays.length * availableW) / Math.max(1, availableH))));
  const rows = Math.max(1, Math.ceil(plays.length / columns));
  const gap = plays.length > 80 ? 3 : 4;
  const size = Math.max(3.8, Math.min(11, (availableW - (columns - 1) * gap) / columns, (availableH - (rows - 1) * gap) / rows));
  const startX = panel.x0 + padding + Math.max(0, (availableW - columns * size - (columns - 1) * gap) / 2);
  const startY = panel.y0 + top + Math.max(0, (availableH - rows * size - (rows - 1) * gap) / 2);
  return plays
    .slice()
    .sort((a, b) => d3.ascending(fieldMeta.theme.value(a), fieldMeta.theme.value(b)) || d3.ascending(a.title, b.title))
    .map((play, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const theme = fieldMeta.theme.value(play);
      const otherAxis = activeAxis === "relation" ? "narrative" : "relation";
      const other = fieldMeta[otherAxis].value(play);
      return {
        play,
        x: startX + col * (size + gap),
        y: startY + row * (size + gap),
        size,
        fill: softenColor(themeColor(theme), 0.78, 0.2),
        stroke: softenColor(otherColor(other), 0.84, 0.08),
        selected: selectedCubeId && play.cubeId === selectedCubeId
      };
    });
}

function softenColor(value, opacity = 0.68, mix = 0.18) {
  const c = d3.color(value) || d3.color("#999");
  const target = d3.color("#f7ecd7");
  c.r = Math.round(c.r * (1 - mix) + target.r * mix);
  c.g = Math.round(c.g * (1 - mix) + target.g * mix);
  c.b = Math.round(c.b * (1 - mix) + target.b * mix);
  c.opacity = opacity;
  return c.formatRgb();
}

function drawParticleLegend(svg, fieldMeta, activeAxis, themeColor, otherColor, themeValues, otherValues, width) {
  const otherAxis = activeAxis === "relation" ? "narrative" : "relation";
  const legend = svg.append("g").attr("class", "layer2-particle-legend").attr("transform", `translate(${width - 390},22)`);
  legend.append("text").attr("class", "layer2-particle-legend-title").attr("x", 0).attr("y", 0)
    .text(`填充:${fieldMeta.theme.label} / 描边:${fieldMeta[otherAxis].label}`);
  const themes = [...themeValues].slice(0, 6);
  const others = [...otherValues].slice(0, 5);
  legend.selectAll("rect.theme").data(themes).join("rect")
    .attr("class", "theme")
    .attr("x", (_, i) => i * 34).attr("y", 12).attr("width", 20).attr("height", 8).attr("rx", 2)
    .attr("fill", (d) => themeColor(d));
  legend.selectAll("rect.other").data(others).join("rect")
    .attr("class", "other")
    .attr("x", (_, i) => i * 34).attr("y", 27).attr("width", 20).attr("height", 8).attr("rx", 2)
    .attr("fill", "rgba(247,236,215,0.08)").attr("stroke", (d) => otherColor(d)).attr("stroke-width", 2);
}

function buildAxisTreemapChildren(plays, activeAxis, fieldMeta) {
  if (activeAxis === "theme") {
    const root = { children: new Map() };
    for (const play of plays) {
      const path = getPlayThemePath(play);
      const levels = (path.length ? path : [fieldMeta.theme.value(play)]).filter(Boolean).slice(0, 3);
      let cursor = root;
      for (const theme of levels) {
        if (!cursor.children.has(theme)) cursor.children.set(theme, { name: theme, axis: activeAxis, children: new Map() });
        cursor = cursor.children.get(theme);
      }
      if (!cursor.plays) cursor.plays = [];
      cursor.plays.push(play);
    }
    return materializeThemeTreemap(root.children);
  }

  return d3.groups(plays, (play) => fieldMeta[activeAxis].value(play))
    .sort((a, b) => d3.descending(a[1].length, b[1].length))
    .map(([name, items]) => ({
      name,
      axis: activeAxis,
      children: items.map((play) => ({ name: play.title || play.play_id, play }))
    }));
}

function axisTreemapPalette(activeAxis) {
  const palettes = {
    theme: ["#9f6c48", "#92575a", "#9a834d", "#718d80", "#70859d", "#8f6f8f", "#a87958", "#7f8458", "#85614f", "#64898c"],
    relation: ["#7fb0a6", "#b9a86b", "#8daac6", "#c28c74", "#a991bd", "#91ad78", "#c07d86", "#83a0a0", "#b5a078", "#7698b4"],
    narrative: ["#c08a66", "#a8a969", "#829fbd", "#b684a4", "#7faf9f", "#c07778", "#9b94bf", "#b9a15e", "#8ea379", "#bd8b72"]
  };
  return palettes[activeAxis] || palettes.theme;
}

function materializeThemeTreemap(children) {
  return [...children.values()]
    .map((node) => {
      const childGroups = materializeThemeTreemap(node.children || new Map());
      const playLeaves = (node.plays || []).map((play) => ({ name: play.title || play.play_id, play }));
      return {
        name: node.name,
        axis: node.axis,
        children: [...childGroups, ...playLeaves]
      };
    })
    .sort((a, b) => d3.descending(countTreemapLeaves(a), countTreemapLeaves(b)));
}

function countTreemapLeaves(node) {
  if (node.play) return 1;
  return d3.sum(node.children || [], countTreemapLeaves);
}

function treemapFill(d, color, fieldMeta, order, activeAxis) {
  if (d.data.play && activeAxis === "theme") return `url(#layer2-treemap-play-${cssSafeId(d.data.play.play_id || d.data.play.title)})`;
  const colorKey = activeAxis === "theme"
    ? d.data.name
    : (d.depth === 1 ? d.data.name : d.ancestors().find((item) => item.depth === 1)?.data.name);
  const base = d3.color(colorKey ? color(colorKey) : fieldMeta[order[0]].color) || d3.color(fieldMeta[order[0]].color);
  if (d.data.play) return tuneTreemapColor(base, activeAxis, "leaf");
  const next = d3.color(tuneTreemapColor(base, activeAxis, d.depth > 1 ? "branch" : "group"));
  next.opacity = d.depth === 1 ? 0.22 : 0.18;
  return next.formatRgb();
}

function tuneTreemapColor(value, activeAxis, role = "leaf") {
  const color = d3.hsl(value);
  const axisLightness = {
    theme: { leaf: 0.41, branch: 0.35, group: 0.31 },
    relation: { leaf: 0.57, branch: 0.47, group: 0.42 },
    narrative: { leaf: 0.56, branch: 0.46, group: 0.41 }
  };
  const axisSaturation = {
    theme: 0.34,
    relation: 0.43,
    narrative: 0.45
  };
  const targetL = axisLightness[activeAxis]?.[role] ?? 0.54;
  const targetS = axisSaturation[activeAxis] ?? 0.44;
  const minS = activeAxis === "theme" ? 0.22 : 0.32;
  const maxS = activeAxis === "theme" ? 0.44 : 0.58;
  const minL = activeAxis === "theme" ? 0.26 : 0.34;
  const maxL = activeAxis === "theme" ? 0.48 : 0.62;
  color.s = clampRange(color.s * 0.45 + targetS * 0.55, minS, maxS);
  color.l = clampRange(color.l * 0.34 + targetL * 0.66, minL, maxL);
  return color.formatHex();
}

function buildTreemapThemeColorLookup(children, color) {
  const lookup = new Map();
  for (const child of children) {
    visit(child);
  }
  return lookup;

  function visit(node) {
    lookup.set(node.name, color(node.name));
    for (const child of node.children || []) {
      if (!child.play) visit(child);
    }
  }
}

function defineTreemapPlayGradients(defs, leaves, activeAxis, fieldMeta, themeColorLookup, fallbackColor) {
  if (activeAxis !== "theme") return;
  const gradient = defs.selectAll("linearGradient.layer2-play-gradient")
    .data(leaves, (d) => d.data.play.play_id || d.data.play.title)
    .join("linearGradient")
    .attr("class", "layer2-play-gradient")
    .attr("id", (d) => `layer2-treemap-play-${cssSafeId(d.data.play.play_id || d.data.play.title)}`)
    .attr("x1", "0%")
    .attr("x2", "100%")
    .attr("y1", "0%")
    .attr("y2", "100%");

  gradient.each(function (d) {
    const stops = themeGradientStops(d.data.play, fieldMeta, themeColorLookup, fallbackColor);
    const g = d3.select(this);
    g.selectAll("stop").remove();
    if (stops.length === 1) {
      g.append("stop").attr("offset", "0%").attr("stop-color", stops[0].color);
      g.append("stop").attr("offset", "100%").attr("stop-color", stops[0].color);
      return;
    }
    let offset = 0;
    g.append("stop").attr("offset", "0%").attr("stop-color", stops[0].color);
    stops.slice(1).forEach((stop, index) => {
      offset += stops[index].weight;
      g.append("stop").attr("offset", `${Math.round(offset * 100)}%`).attr("stop-color", stop.color);
    });
    g.append("stop").attr("offset", "100%").attr("stop-color", stops[stops.length - 1].color);
  });
}

function themeGradientStops(play, fieldMeta, themeColorLookup, fallbackColor) {
  const weighted = (play.topic?.themes || [])
    .filter((theme) => theme.theme)
    .sort((a, b) => d3.descending(a.weight || 0, b.weight || 0))
    .slice(0, 3)
    .map((theme) => ({
      name: theme.theme,
      weight: Math.max(0.001, Number(theme.weight || 0))
    }));
  const fallbackPath = getPlayThemePath(play);
  const raw = weighted.length
    ? weighted
    : fallbackPath.map((name) => ({ name, weight: 1 })).slice(0, 3);
  const safe = raw.length ? raw : [{ name: fieldMeta.theme.value(play), weight: 1 }];
  const total = d3.sum(safe, (item) => item.weight) || 1;
  return safe.map((item) => ({
    color: tuneTreemapColor(themeColorLookup.get(item.name) || fallbackColor(item.name) || fieldMeta.theme.color, "theme", "leaf"),
    weight: item.weight / total
  }));
}

function drawTreemapLegend(svg, groups, color, activeAxis, fieldMeta, width) {
  const legend = svg.node()?.closest(".page")?.querySelector(".layer2-treemap-legend");
  if (!legend) return;
  const items = groups.slice(0, 12).map((group) => ({
    name: group.name,
    count: countTreemapLeaves(group),
    color: color(group.name)
  }));
  legend.innerHTML = `
    <div class="layer2-treemap-legend-title">${escapeHtml(fieldMeta[activeAxis].label)}</div>
    ${items.map((item) => `
      <div class="layer2-treemap-legend-item">
        <span class="layer2-treemap-legend-swatch" style="background:${item.color}"></span>
        <span>${escapeHtml(shortLabel(item.name, 7))} ${item.count}</span>
      </div>
    `).join("")}
  `;
}

function cssSafeId(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function showTreemapTooltip(svg, d, event, fieldMeta, order, width, height) {
  const play = d.data.play;
  const axis = order[0];
  const axisValue = axis === "theme" ? getPlayThemePath(play).join(" / ") || fieldMeta[axis].value(play) : fieldMeta[axis].value(play);
  const axisText = `${fieldMeta[axis].label}:${axisValue}`;
  const extra = ["theme", "relation", "narrative"]
    .filter((item) => item !== axis)
    .map((item) => fieldMeta[item].value(play))
    .filter(Boolean)
    .slice(0, 2)
    .join(" / ");
  const tooltip = svg.select(".layer2-treemap-tooltip").style("display", null).raise();
  tooltip.select(".tooltip-title").text(play.title || play.play_id);
  tooltip.select(".tooltip-theme").text(axisText);
  tooltip.select(".tooltip-meta").text(extra);

  const boxWidth = Math.min(340, Math.max(210, (play.title || "").length * 15 + 42));
  const boxHeight = 70;
  tooltip.select("rect").attr("width", boxWidth).attr("height", boxHeight);
  const [mx, my] = d3.pointer(event, svg.node());
  const tx = Math.min(width - boxWidth - 10, mx + 14);
  const ty = Math.min(height - boxHeight - 10, my + 12);
  tooltip.attr("transform", `translate(${Math.max(8, tx)},${Math.max(8, ty)})`);
}

function drawThemeOverview(svg, model, state, meta) {
  const width = 980;
  const height = 520;
  const selected = new Set(state.selectedPlayIds || []);
  const grouped = d3.groups(model.plays, (play) => getPlayThemePath(play)[0] || play.theme || "主题待分析")
    .sort((a, b) => d3.descending(a[1].length, b[1].length))
    .slice(0, 12);

  const center = [width * 0.5, height * 0.51];
  const inner = 62;
  const outer = 210;
  const palette = ["#e8c06c", "#a8c6bb", "#e1a476", "#c5b2d6", "#9dc5d4", "#d7a0a4", "#b9c98b", "#d9ba8d", "#aeb9d8", "#c6b49a"];
  const root = svg.append("g").attr("transform", `translate(${center[0]},${center[1]})`);

  root.append("circle").attr("class", "layer2-theme-core").attr("r", inner);
  root.append("text").attr("class", "layer2-theme-core-label").attr("text-anchor", "middle").attr("y", -3).text("主题");
  root.append("text").attr("class", "layer2-theme-core-count").attr("text-anchor", "middle").attr("y", 18).text(`${model.plays.length} 部`);

  grouped.forEach(([theme, plays], groupIndex) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * groupIndex) / grouped.length;
    const color = palette[groupIndex % palette.length];
    const tx = Math.cos(angle) * 130;
    const ty = Math.sin(angle) * 112;
    const branch = root.append("g").attr("class", "layer2-theme-branch");
    branch.append("path")
      .attr("class", "life-link")
      .attr("stroke", color)
      .attr("d", `M${Math.cos(angle) * inner},${Math.sin(angle) * inner} C${tx * 0.52},${ty * 0.52} ${tx * 0.86},${ty * 0.86} ${tx},${ty}`);
    branch.append("circle")
      .attr("class", "theme-branch-dot focus")
      .attr("cx", tx)
      .attr("cy", ty)
      .attr("r", Math.min(12, 4.5 + Math.sqrt(plays.length) * 0.45))
      .attr("fill", color);
    branch.append("text")
      .attr("class", "theme-branch-label")
      .attr("x", tx + (tx >= 0 ? 14 : -14))
      .attr("y", ty + 4)
      .attr("text-anchor", tx >= 0 ? "start" : "end")
      .text(shortLabel(theme, 8));

    const picked = pickPlays(plays, selected, 11);
    picked.forEach((play, playIndex) => {
      const spread = picked.length === 1 ? 0 : (playIndex / (picked.length - 1) - 0.5) * 0.58;
      const leafAngle = angle + spread;
      const leafRadius = outer + (playIndex % 3) * 13;
      const lx = Math.cos(leafAngle) * leafRadius;
      const ly = Math.sin(leafAngle) * leafRadius * 0.88;
      const isSelected = selected.has(play.play_id);
      branch.append("path")
        .attr("class", `life-link-extension ${isSelected ? "link-extension--selected" : ""}`)
        .attr("stroke", color)
        .attr("d", `M${tx},${ty} C${tx * 1.16},${ty * 1.16} ${lx * 0.88},${ly * 0.88} ${lx},${ly}`);
      branch.append("circle")
        .attr("class", `theme-leaf-dot ${isSelected ? "selected" : ""}`)
        .attr("cx", lx)
        .attr("cy", ly)
        .attr("r", isSelected ? 5.2 : 3.4)
        .attr("fill", color)
        .on("click", (event) => {
          event.stopPropagation();
          window.openPlay(play.play_id);
        })
        .append("title")
        .text(`${play.title}\n${theme}`);
    });
  });

  svg.append("text")
    .attr("class", "theme-tree-note")
    .attr("x", width - 32)
    .attr("y", height - 28)
    .attr("text-anchor", "end")
    .text("点击剧本点进入第四层");
}

function drawGroupedOverview(svg, groups, selectedPlayIds, meta) {
  const width = 980;
  const height = 520;
  const selected = new Set(selectedPlayIds);
  const palette = ["#a8c6bb", "#e1a476", "#e8c06c", "#9dc5d4", "#d7a0a4", "#b9c98b", "#c5b2d6", "#d9ba8d", "#aeb9d8", "#c6b49a"];
  const nodes = [];
  const links = [];
  const ring = Math.min(270, 118 + groups.length * 14);

  groups.forEach(([name, plays], groupIndex) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * groupIndex) / Math.max(1, groups.length);
    const color = palette[groupIndex % palette.length];
    const groupId = `group:${groupIndex}`;
    const cx = width / 2 + Math.cos(angle) * ring;
    const cy = height / 2 + Math.sin(angle) * ring * 0.58;
    nodes.push({ id: groupId, name, kind: "group", color, radius: Math.min(30, 12 + Math.sqrt(plays.length) * 0.7), cx, cy });
    pickPlays(plays, selected, 12).forEach((play) => {
      const active = selected.has(play.play_id);
      nodes.push({
        id: play.play_id,
        playId: play.play_id,
        name: play.title,
        kind: "play",
        color,
        radius: active ? 7.8 : 5,
        cx,
        cy,
        selected: active
      });
      links.push({ source: groupId, target: play.play_id, color, selected: active });
    });
  });

  const viewport = svg.append("g");
  svg.call(d3.zoom().scaleExtent([0.78, 2.4]).on("zoom", (event) => viewport.attr("transform", event.transform)));

  const link = viewport.append("g").selectAll("line")
    .data(links)
    .join("line")
    .attr("class", (d) => `context-force-link ${d.selected ? "selected" : ""}`)
    .attr("stroke", (d) => d.color);

  const node = viewport.append("g").selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", (d) => `context-force-node ${d.kind} ${d.selected ? "selected" : ""}`)
    .on("click", (event, d) => {
      event.stopPropagation();
      if (d.playId) window.openPlay(d.playId);
    });

  node.append("circle").attr("r", (d) => d.radius).attr("fill", (d) => d.color);
  node.append("text")
    .attr("class", (d) => `context-force-label ${d.kind} ${d.selected ? "selected" : ""}`)
    .attr("x", (d) => d.radius + 5)
    .attr("y", 4)
    .text((d) => shortLabel(d.name, d.kind === "group" ? 9 : 5));

  const simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((d) => d.id).distance(48).strength(0.82))
    .force("charge", d3.forceManyBody().strength((d) => (d.kind === "group" ? -360 : -76)))
    .force("x", d3.forceX((d) => d.cx).strength((d) => (d.kind === "group" ? 0.22 : 0.09)))
    .force("y", d3.forceY((d) => d.cy).strength((d) => (d.kind === "group" ? 0.22 : 0.09)))
    .force("collide", d3.forceCollide().radius((d) => d.radius + 12))
    .stop();

  for (let i = 0; i < 180; i += 1) simulation.tick();
  ticked();

  function ticked() {
    for (const d of nodes) {
      d.x = Math.max(34, Math.min(width - 80, d.x));
      d.y = Math.max(32, Math.min(height - 40, d.y));
    }
    link
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);
    node.attr("transform", (d) => `translate(${d.x},${d.y})`);
  }

  svg.append("text")
    .attr("class", "theme-tree-note")
    .attr("x", width - 32)
    .attr("y", height - 28)
    .attr("text-anchor", "end")
    .text("点击剧本点进入第四层，滚轮可缩放");
}

export function drawRoleAttributeSankey(svg, roleTable, state) {
  svg.selectAll("*").remove();
  const width = 2100;
  const height = 720;
  const margin = { top: 2, right: 42, bottom: 2, left: 158 };
  const allRecords = roleTable
    .filter((item) => item && (item.predicted_fine || item.predicted_broad || item.original_category))
    .map((item) => ({
      period: cleanCategory(item.story_era, "") || inferStoryEra(item),
      genre: normalizeGenre(cleanCategory(item.genre, "题材待辨")),
      age: cleanCategory(item.age_group, "年龄待辨"),
      gender: cleanCategory(item.gender, "性别待辨"),
      identity: inferSocialIdentity(item),
      hangdang: normalizeHangdang(item.predicted_fine || item.predicted_broad || item.original_category)
    }));

  if (!allRecords.length) {
    drawEmpty(svg, "角色属性数据加载中");
    return;
  }

  const eras = buildEraTabs(allRecords);
  const activeEra = eras.some((item) => item.key === state.layer2SankeyEra) ? state.layer2SankeyEra : "all";
  const records = activeEra === "all" ? allRecords : allRecords.filter((record) => record.period === activeEra);
  drawSankeyEraTabs(svg, eras, activeEra);

  const columns = [
    { key: "genre", title: "题材", limit: 9 },
    { key: "age", title: "年龄", limit: 5 },
    { key: "gender", title: "性别", limit: 4 },
    { key: "identity", title: "社会身份", limit: 10 },
    { key: "hangdang", title: "行当", limit: 8 }
  ];
  const allowed = new Map(columns.map((column) => [column.key, topValues(records, column.key, column.limit)]));
  const normalized = records.map((record) => {
    const next = {};
    for (const column of columns) {
      next[column.key] = allowed.get(column.key).has(record[column.key]) ? record[column.key] : "其他";
    }
    return next;
  });

  const nodeMap = new Map();
  const linksByKey = new Map();
  for (const column of columns) {
    for (const value of new Set(normalized.map((record) => record[column.key]))) {
      const id = `${column.key}:${value}`;
      nodeMap.set(id, { id, name: value, column: column.key, columnTitle: column.title });
    }
  }
  for (const record of normalized) {
    for (let i = 0; i < columns.length - 1; i += 1) {
      const source = `${columns[i].key}:${record[columns[i].key]}`;
      const target = `${columns[i + 1].key}:${record[columns[i + 1].key]}`;
      const key = `${source}->${target}`;
      if (!linksByKey.has(key)) linksByKey.set(key, { source, target, value: 0 });
      linksByKey.get(key).value += 1;
    }
  }

  const graph = {
    nodes: [...nodeMap.values()],
    links: [...linksByKey.values()].filter((link) => link.value > 0)
  };

  sankey()
    .nodeId((d) => d.id)
    .nodeWidth(14)
    .nodePadding(16)
    .nodeAlign(sankeyJustify)
    .extent([[margin.left, margin.top + 24], [width - margin.right, height - margin.bottom]])
    (graph);

  const defs = svg.append("defs");
  const gradient = defs.selectAll("linearGradient")
    .data(graph.links)
    .join("linearGradient")
    .attr("id", (_, index) => `layer2-sankey-gradient-${index}`)
    .attr("gradientUnits", "userSpaceOnUse")
    .attr("x1", (d) => d.source.x1)
    .attr("x2", (d) => d.target.x0);
  gradient.append("stop").attr("offset", "0%").attr("stop-color", (d) => sankeyColor(d.source));
  gradient.append("stop").attr("offset", "100%").attr("stop-color", (d) => sankeyColor(d.target));

  svg.append("g")
    .attr("fill", "none")
    .selectAll("path")
    .data(graph.links)
    .join("path")
    .attr("class", "layer2-sankey-link")
    .attr("d", sankeyLinkHorizontal())
    .attr("stroke", (_, index) => `url(#layer2-sankey-gradient-${index})`)
    .attr("stroke-width", (d) => Math.max(1, d.width))
    .append("title")
    .text((d) => `${d.source.columnTitle}:${d.source.name} -> ${d.target.columnTitle}:${d.target.name}\n${d.value} 个角色`);

  const node = svg.append("g")
    .selectAll("g")
    .data(graph.nodes)
    .join("g")
    .attr("class", "layer2-sankey-node");

  node.append("rect")
    .attr("x", (d) => d.x0)
    .attr("y", (d) => d.y0)
    .attr("height", (d) => Math.max(1, d.y1 - d.y0))
    .attr("width", (d) => d.x1 - d.x0)
    .attr("fill", (d) => sankeyColor(d))
    .append("title")
    .text((d) => `${d.columnTitle}:${d.name}\n${d.value} 个角色`);

  node.append("text")
    .attr("class", "layer2-sankey-label")
    .attr("x", (d) => d.x0 < width / 2 ? d.x1 + 7 : d.x0 - 7)
    .attr("y", (d) => (d.y0 + d.y1) / 2)
    .attr("dy", "0.35em")
    .attr("text-anchor", (d) => d.x0 < width / 2 ? "start" : "end")
    .text((d) => shortLabel(`${d.name} ${d.value}`, 13));

  svg.append("g")
    .selectAll("text")
    .data(columns)
    .join("text")
    .attr("class", "layer2-sankey-column-title")
    .attr("x", (_, index) => margin.left + (index * (width - margin.left - margin.right - 14)) / (columns.length - 1))
    .attr("y", 20)
    .attr("text-anchor", "middle")
    .text((d) => d.title);

  svg.append("text")
    .attr("class", "theme-tree-note")
    .attr("x", width - 18)
    .attr("y", height - 8)
    .attr("text-anchor", "end")
    .text(`${records.length}/${allRecords.length} 角色`);
}

function buildEraTabs(records) {
  const preferred = ["all", "春秋战国", "秦汉", "魏晋南北朝", "隋唐", "宋元", "元末明初", "明清", "三国", "神话传说", "民间世情", "近代民间", "时代未识别"];
  const counts = d3.rollup(records, (items) => items.length, (item) => item.period);
  const eras = [...counts.entries()]
    .filter(([era]) => era && era !== "null" && era !== "undefined")
    .sort((a, b) => {
      const ai = preferred.indexOf(a[0]);
      const bi = preferred.indexOf(b[0]);
      if (ai >= 0 || bi >= 0) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
      return d3.descending(a[1], b[1]);
    })
    .map(([key, count]) => ({ key, label: key, count }));
  return [{ key: "all", label: "全部", count: records.length }, ...eras];
}

function drawSankeyEraTabs(svg, eras, activeEra) {
  const tabW = 129;
  const tabH = 44;
  const tabGap = 5;
  const tabX = 8;
  const tabsY = 44;
  const visible = eras.slice(0, 14);
  const tabs = svg.append("g").attr("class", "layer2-sankey-era-tabs");

  tabs.append("text")
    .attr("class", "layer2-sankey-tab-title")
    .attr("x", tabX)
    .attr("y", 22)
    .text("时期");

  visible.forEach((era, index) => {
    const ty = tabsY + index * (tabH + tabGap);
    const isActive = era.key === activeEra;
    const tab = tabs.append("g")
      .attr("class", `zoom-tab layer2-sankey-era-tab ${isActive ? "active" : ""}`)
      .style("cursor", "pointer")
      .on("click", () => window.setLayer2SankeyEra?.(era.key));

    tab.append("rect")
      .attr("x", tabX + (isActive ? -4 : 0))
      .attr("y", ty)
      .attr("width", tabW + (isActive ? 4 : 0))
      .attr("height", tabH)
      .attr("rx", 2)
      .attr("fill", isActive ? "rgba(247,236,215,0.13)" : "rgba(247,236,215,0.035)")
      .attr("stroke", isActive ? "rgba(247,236,215,0.24)" : "rgba(247,236,215,0.07)")
      .attr("stroke-width", 0.6);

    if (isActive) {
      tab.append("rect")
        .attr("class", "tab-accent-bar")
        .attr("x", tabX - 4)
        .attr("y", ty + 4)
        .attr("width", 3)
        .attr("height", tabH - 8)
        .attr("rx", 1.5)
        .attr("fill", "#e8a87c");
    }

    tab.append("text")
      .attr("x", tabX + tabW / 2 + (isActive ? 2 : 0))
      .attr("y", ty + 18)
      .attr("text-anchor", "middle")
      .attr("fill", isActive ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.42)")
      .style("font-size", isActive ? "15px" : "14px")
      .style("font-weight", isActive ? "700" : "500")
      .text(shortLabel(era.label, 6));

    tab.append("text")
      .attr("x", tabX + tabW / 2 + (isActive ? 2 : 0))
      .attr("y", ty + 35)
      .attr("text-anchor", "middle")
      .attr("fill", isActive ? "rgba(236,219,178,0.68)" : "rgba(236,219,178,0.34)")
      .style("font-size", "12px")
      .style("font-weight", "700")
      .text(`${era.count} 角色`);

    tab.on("mouseenter", function () {
      if (isActive) return;
      d3.select(this).select("rect").attr("fill", "rgba(247,236,215,0.08)");
      d3.select(this).selectAll("text").attr("fill", "rgba(255,255,255,0.72)");
    }).on("mouseleave", function () {
      if (isActive) return;
      d3.select(this).select("rect").attr("fill", "rgba(247,236,215,0.035)");
      d3.select(this).selectAll("text").attr("fill", (_, i) => i === 0 ? "rgba(255,255,255,0.42)" : "rgba(236,219,178,0.34)");
    });
  });
}

function buildGroups(plays, field, selectedPlayIds, limit) {
  const selected = new Set(selectedPlayIds);
  return d3.groups(plays.filter((play) => play[field]), (play) => play[field])
    .sort((a, b) => {
      const selectedDelta = Number(b[1].some((play) => selected.has(play.play_id))) - Number(a[1].some((play) => selected.has(play.play_id)));
      return selectedDelta || d3.descending(a[1].length, b[1].length);
    })
    .slice(0, limit);
}

function topValues(records, key, limit) {
  const valueOf = typeof key === "function" ? key : (item) => item[key];
  return new Set(d3.rollups(records, (items) => items.length, valueOf)
    .sort((a, b) => d3.descending(a[1], b[1]))
    .slice(0, limit)
    .map(([value]) => value));
}

function firstValue(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function cleanCategory(value, fallback) {
  const text = String(value ?? "").trim();
  return text && text !== "null" && text !== "undefined" ? text : fallback;
}

function inferStoryEra(record) {
  const text = `${record.title || ""} ${record.role || ""} ${record.genre || ""}`;
  const rules = [
    ["春秋战国", /伍员|伍子胥|专诸|要离|庆忌|荆轲|太子丹|秦王|田单|孙膑|庞涓|廉颇|蔺相如|豫让|无忌|信陵|赵氏孤儿|鱼肠剑|文昭关|黄金台|刺王僚/],
    ["秦汉", /项羽|刘邦|韩信|萧何|樊哙|虞姬|霸王|鸿门|王莽|苏武|李陵|昭君|汉|楚汉/],
    ["三国", /诸葛亮|刘备|关羽|张飞|曹操|孙权|周瑜|赵云|姜维|司马懿|司马昭|吕布|貂蝉|黄忠|马超|魏延|鲁肃|荀彧|程昱|许褚|颜良|文丑|华容道|空城计|群英会|定军山|白门楼|战北原|天水关|七星灯|黄鹤楼|柴桑口|捉放曹|打鼓骂曹/],
    ["隋唐", /李世民|秦琼|尉迟|程咬金|罗成|单雄信|薛仁贵|薛丁山|樊梨花|武则天|唐|隋|瓦岗|汾河湾|打金枝|沙陀国|八大锤|罗成|摩天岭|破洪州|虹霓关/],
    ["宋元", /杨延昭|杨宗保|佘太君|孟良|焦赞|包拯|包公|赵德芳|赵匡胤|岳飞|秦桧|韩世忠|梁山|宋江|武松|林冲|鲁智深|金兀术|萧恩|杨家将|洪羊洞|铡美案|乌盆计|探阴山|打龙袍|辕门斩子|风波亭|连环套/],
    ["明清", /朱元璋|刘伯温|海瑞|严嵩|崇祯|侯方域|李香君|阮大铖|桃花扇|红楼|贾宝玉|林黛玉|王熙凤|尤二姐|杜十娘|玉堂春|苏三|钗头凤|陆游|唐婉|清|明/],
    ["神话传说", /哪吒|杨戬|沉香|三圣母|白蛇|许仙|观音|目莲|嫦娥|仙|神|妖|鬼|阴山|宝莲灯|滑油山|目莲救母|赵颜借寿|南斗|北斗/],
    ["近代民间", /民国|近代|现代|小上坟|打花鼓|纺棉花/]
  ];
  for (const [label, pattern] of rules) {
    if (pattern.test(text)) return label;
  }
  return "时代未识别";
}

function normalizeHangdang(hangdang) {
  const value = cleanCategory(hangdang, "其他");
  if (value.includes("生")) return "生";
  if (value.includes("旦")) return "旦";
  if (value.includes("净")) return "净";
  if (value.includes("丑")) return "丑";
  return value === "其他" ? "其他" : value;
}

function normalizeGenre(genre) {
  const value = cleanCategory(genre, "题材待辨");
  if (/战争|权谋|军事|征战|三国|水浒/.test(value)) return "权谋战争";
  if (/家庭|伦理|孝|母|父|子/.test(value)) return "家庭伦理";
  if (/公案|审判|清官|断案|冤案|案/.test(value)) return "公案审判";
  if (/婚|恋|情|姻缘|花田|鸳鸯/.test(value)) return "婚恋离合";
  if (/神|仙|佛|妖|鬼|怪|道/.test(value)) return "神怪仙佛";
  if (/忠|义|报国/.test(value)) return "忠义报国";
  if (/复仇|报仇|雪恨|仇/.test(value)) return "复仇雪恨";
  if (/离别|流亡|逃|送别/.test(value)) return "离别流亡";
  if (/仕途|功名|官场|科举|状元/.test(value)) return "仕途功名";
  return value;
}

function inferSocialIdentity(record) {
  const role = String(record.role || "");
  const identity = cleanCategory(firstValue(record.identity), "");
  const text = `${role} ${identity} ${record.title || ""}`;

  const rules = [
    ["君主/皇室", /皇|帝|王|君|主|圣上|天子|殿下|太子|公主|娘娘|后|妃|王爷|千岁|赵德芳|李世民|刘备|孙权|曹操|朱元璋|崇祯/],
    ["臣子/官员", /臣|官|相|丞相|宰相|太师|太尉|尚书|御史|知府|县令|知县|府尹|巡抚|总督|钦差|太守|刺史|司徒|司马|寇准|包拯|海瑞|刘伯温/],
    ["将帅/军士", /将|帅|军|兵|卒|校尉|都督|元帅|先锋|副将|中军|旗牌|马童|报子|探子|喽啰|关羽|张飞|赵云|马超|韩信|岳飞|杨延昭|杨宗保/],
    ["富户/地主", /地主|员外|财主|富户|庄主|老爷|东家|掌柜|富|豪|绅|乡绅|财|贾/],
    ["百姓/农民", /农|民|百姓|村|庄|樵|渔|牧|猎|佃|田|乡民|老汉|老丈|婆|嫂|姑|哥|弟|孩|妞|丫头/],
    ["商贩/工匠", /商|贩|店|铺|匠|工|船夫|车夫|脚夫|酒保|茶博士|掌柜|伙计/],
    ["仆从/差役", /仆|奴|婢|丫鬟|家院|家丁|院子|书童|童儿|小厮|差役|衙役|皂隶|太监|宫女|侍卫|门子/],
    ["僧道/神怪", /僧|和尚|沙弥|道士|道人|仙|神|佛|鬼|妖|怪|判官|土地|龙王|阎|观音|哪吒|杨戬/],
    ["盗匪/江湖", /盗|贼|匪|寇|强人|山大王|寨主|绿林|梁山|宋江|武松|林冲|鲁智深/],
    ["家庭女性", /夫人|小姐|娘子|媳|妻|母|妈|婆|嫂|姐|妹|女|旦|潘金莲|林黛玉|王熙凤|李香君|虞姬/]
  ];

  for (const [label, pattern] of rules) {
    if (pattern.test(text)) return label;
  }
  if (/主角|正面/.test(identity)) return "主要人物";
  if (/配角|喜剧/.test(identity)) return "配角/随从";
  return "身份待辨";
}

function sankeyColor(node) {
  const palettes = {
    genre: "#d7c17f",
    age: "#d9ba8d",
    gender: "#c5b2d6",
    identity: "#e1a476",
    hangdang: null
  };
  if (node.column === "hangdang") {
    return { 生: "#6fa8dc", 旦: "#e8706d", 净: "#72c384", 丑: "#f0a34b", 其他: "#c89bd0" }[node.name] || "#c89bd0";
  }
  return palettes[node.column] || "#e8c06c";
}

function pickPlays(plays, selected, limit) {
  return [...plays]
    .sort((a, b) => Number(selected.has(b.play_id)) - Number(selected.has(a.play_id)) || d3.ascending(a.title, b.title))
    .slice(0, limit);
}

function getPlayThemePath(play) {
  const themes = (play.topic?.themes || [])
    .filter((theme) => theme.theme && (theme.weight || 0) > 0)
    .sort((a, b) => d3.descending(a.weight || 0, b.weight || 0));
  const path = themes.filter((theme, index) => index === 0 || (theme.weight || 0) >= 0.055).slice(0, 3).map((theme) => theme.theme);
  if (!path.length && play.theme) path.push(play.theme);
  return [...new Set(path)].slice(0, 3);
}

function uniqueValues(items, field) {
  return [...new Set(items.map((item) => item[field]).filter(Boolean))];
}

function ordinalIndex(values) {
  const map = new Map(values.map((value, index) => [value, index]));
  const denom = Math.max(1, values.length - 1);
  return (value) => 0.35 + ((map.get(value) ?? 0) / denom) * 3.5;
}

function shortLabel(label, limit) {
  if (!label) return "";
  return label.length > limit ? `${label.slice(0, limit)}...` : label;
}

function clampRange(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
}

function drawEmpty(svg, text) {
  svg.append("text")
    .attr("x", 490)
    .attr("y", 260)
    .attr("text-anchor", "middle")
    .attr("class", "theme-tree-note")
    .text(text);
}
