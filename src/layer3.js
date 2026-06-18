// 第三层：一类剧本
// 左上角放大第一/二层选中的小立方体，展示主题、角色关系、叙事结构的三元关联。

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { drawAxisOverview, drawRoleAttributeSankey } from "./layer2.js?v=treemap-20260604x";

const AXIS_META = {
  theme: { label: "主题", title: "主题总图", color: "#e8c06c" },
  relation: { label: "角色关系", title: "角色关系总图", color: "#a8c6bb" },
  narrative: { label: "叙事结构", title: "叙事结构总图", color: "#e1a476" }
};

export function renderLayer3({ app, model, state, helpers }) {
  const cell = resolveSelectedCell(model, state);
  const activeAxis = ["theme", "relation", "narrative"].includes(state.layer3Axis) ? state.layer3Axis : "theme";
  const stats = buildCellStats(cell);
  const title = cell ? `${cell.theme} × ${cell.relation} × ${cell.narrative}` : "未选择组合单元";

  app.innerHTML = `
    <main class="page page--layer3">
      <section class="layer3-grid layer-analysis-grid">
        <div class="card layer3-cube-card">
          <div class="slot">
            <div class="layer3-detail-cube-wrap">
              <canvas id="layer3-detail-cube" aria-label="选中组合单元的三元关联小立方体"></canvas>
              <div id="layer3-detail-cube-tip" class="layer3-detail-cube-tip" style="display:none"></div>
              <div class="layer3-cell-summary collapsed">
                <button type="button" class="layer3-cell-summary-toggle" onclick="toggleLayer3Summary(this)" aria-label="展开说明">展开</button>
                <strong>${escapeHtml(title)}</strong>
                <span>${stats.count} 部剧本 · 均值：主题 ${formatPct(stats.avgTheme)} / 关系 ${formatPct(stats.avgRelation)} / 叙事 ${formatPct(stats.avgNarrative)}</span>
                <em>点=剧本相对本类均值的偏移，线=三者相似关联；拖拽旋转，滚轮缩放。</em>
              </div>
              <div class="layer3-axis-switch" aria-label="第三层视角切换">
                ${axisButton("theme", activeAxis)}
                ${axisButton("relation", activeAxis)}
                ${axisButton("narrative", activeAxis)}
              </div>
              <div id="layer3-treemap-legend" class="layer2-treemap-legend layer3-treemap-legend"></div>
            </div>
          </div>
        </div>
        <div class="card layer3-overview-card">
          <div class="layer2-panel-title">
            <span>${escapeHtml(AXIS_META[activeAxis].title)}</span>
            <strong>当前组合单元内剧本；点击剧本进入第四层</strong>
          </div>
          <div class="slot">
            <svg id="layer3-axis-overview" class="layer2-overview-svg" viewBox="0 0 1720 520" preserveAspectRatio="xMidYMid meet"></svg>
          </div>
        </div>
        <div class="card layer3-sankey-card">
          <div class="layer2-side-title">
            <span>角色属性对应图</span>
            <strong>时期书签 / 题材 / 年龄 / 性别 / 社会身份 / 行当</strong>
          </div>
          <div class="slot">
            <svg id="layer3-role-sankey" class="layer2-sankey-svg" viewBox="0 0 2100 720" preserveAspectRatio="xMidYMid meet"></svg>
          </div>
        </div>
      </section>
      <button type="button" class="layer-back-button" onclick="goLayer(2)" aria-label="返回第二层">
        <span class="layer-back-icon" aria-hidden="true"></span>
        <span class="layer-back-eyebrow">返回</span>
        <span class="layer-back-text">第二层总览</span>
      </button>
    </main>
  `;

  renderTriadCube(cell, activeAxis);
  renderLayer3ReuseViews(cell, model, state, activeAxis);
}

function resolveSelectedCell(model, state) {
  if (state.selectedCubeId && model.cubeById?.has(state.selectedCubeId)) {
    return model.cubeById.get(state.selectedCubeId);
  }
  const selectedPlay = model.playsById?.get(state.selectedPlayId);
  if (selectedPlay?.cubeId && model.cubeById?.has(selectedPlay.cubeId)) {
    return model.cubeById.get(selectedPlay.cubeId);
  }
  return model.cubeCells?.[0] || null;
}

function renderTriadCube(cell, activeAxis) {
  const canvas = document.querySelector("#layer3-detail-cube");
  const wrap = canvas?.parentElement;
  const tooltip = document.querySelector("#layer3-detail-cube-tip");
  if (!canvas || !wrap || !cell) return;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.24;

  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(38, wrap.clientWidth / wrap.clientHeight, 0.1, 100);
  camera.position.set(9.5, 7.4, 10.5);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 5.8;
  controls.maxDistance = 23;
  controls.update();

  scene.add(new THREE.AmbientLight(0xffffff, 0.58));
  const key = new THREE.DirectionalLight(0xffffff, 0.92);
  key.position.set(8, 12, 6);
  scene.add(key);
  const fill = new THREE.PointLight(0xe8c06c, 0.52, 30);
  fill.position.set(-5, 2, 7);
  scene.add(fill);

  const cubeSize = 7.2;
  const half = cubeSize / 2;
  const axisSize = cubeSize * 0.78;
  const axisOrigin = new THREE.Vector3(-axisSize / 2, -axisSize / 2, -axisSize / 2);
  const playMetrics = (cell.plays || []).map(buildPlayMetrics);
  const stats = buildCellStats(cell);

  addCubeFrame(scene, cubeSize, activeAxis);
  addAxis(scene, axisOrigin, new THREE.Vector3(axisSize, 0, 0), "主题", cell.theme, AXIS_META.theme.color, activeAxis === "theme");
  addAxis(scene, axisOrigin, new THREE.Vector3(0, axisSize, 0), "叙事结构", cell.narrative, AXIS_META.narrative.color, activeAxis === "narrative");
  addAxis(scene, axisOrigin, new THREE.Vector3(0, 0, axisSize), "角色关系", cell.relation, AXIS_META.relation.color, activeAxis === "relation");

  const nodeGroup = new THREE.Group();
  const hitTargets = [];
  scene.add(nodeGroup);

  const edges = buildTriadEdges(playMetrics);
  addProjectionMarks(nodeGroup, playMetrics, cubeSize, stats);
  const edgeObjects = addEdges(nodeGroup, edges, cubeSize, stats);
  const projectionTethers = new THREE.Group();
  nodeGroup.add(projectionTethers);
  addNodes(nodeGroup, playMetrics, hitTargets, cubeSize, stats);

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let hovered = null;
  let pointerDown = null;
  let suppressNextClick = false;
  const clickMoveThreshold = 6;

  canvas.addEventListener("mousemove", (event) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(hitTargets, false);
    const next = hits[0]?.object || null;
    if (hovered && hovered !== next) {
      hovered.scale.copy(hovered.userData.baseScale);
      hovered.material.emissiveIntensity = hovered.userData.baseEmissive;
      setEdgeFocus(edgeObjects, null);
      updateProjectionTethers(projectionTethers, null, cubeSize, stats);
      hovered = null;
    }
    if (next) {
      hovered = next;
      hovered.scale.copy(hovered.userData.baseScale).multiplyScalar(1.35);
      hovered.material.emissiveIntensity = 0.55;
      setEdgeFocus(edgeObjects, hovered.userData.metric.play.play_id);
      updateProjectionTethers(projectionTethers, hovered.userData.metric, cubeSize, stats);
      canvas.style.cursor = "pointer";
      showTooltip(tooltip, hovered.userData.metric, event);
    } else {
      setEdgeFocus(edgeObjects, null);
      updateProjectionTethers(projectionTethers, null, cubeSize, stats);
      canvas.style.cursor = "grab";
      tooltip.style.display = "none";
    }
  });

  canvas.addEventListener("mouseleave", () => {
    if (hovered) {
      hovered.scale.copy(hovered.userData.baseScale);
      hovered.material.emissiveIntensity = hovered.userData.baseEmissive;
      setEdgeFocus(edgeObjects, null);
      updateProjectionTethers(projectionTethers, null, cubeSize, stats);
      hovered = null;
    }
    tooltip.style.display = "none";
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
    const playId = hovered?.userData?.metric?.play?.play_id;
    if (playId) window.openLayer3Play?.(playId, activeAxis);
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

function addCubeFrame(scene, size, activeAxis) {
  // Intentionally blank: the third-layer cube keeps only axes, nodes and relations.
}

function addAxis(scene, origin, vector, label, value, color, active) {
  const axisColor = new THREE.Color(color);
  const len = vector.length();
  const direction = vector.clone().normalize();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const group = new THREE.Group();
  group.position.copy(origin);

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(active ? 0.035 : 0.022, active ? 0.035 : 0.022, len, 18),
    new THREE.MeshStandardMaterial({
      color: axisColor,
      emissive: axisColor,
      emissiveIntensity: active ? 0.34 : 0.12,
      roughness: 0.44,
      transparent: true,
      opacity: active ? 0.98 : 0.56
    })
  );
  body.position.copy(direction.clone().multiplyScalar(len / 2));
  body.quaternion.setFromUnitVectors(yAxis, direction);
  group.add(body);

  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(active ? 0.14 : 0.1, 0.34, 24),
    new THREE.MeshStandardMaterial({ color: axisColor, emissive: axisColor, emissiveIntensity: active ? 0.42 : 0.22 })
  );
  arrow.position.copy(direction.clone().multiplyScalar(len + 0.18));
  arrow.quaternion.setFromUnitVectors(yAxis, direction);
  group.add(arrow);

  const title = makeLabel(`${label}: ${shortLabel(value, 8)}`, active ? "rgba(255,239,196,0.98)" : "rgba(236,219,178,0.72)", active ? 34 : 28);
  title.position.copy(direction.clone().multiplyScalar(len + 0.75));
  title.position.y += vector.y ? 0.2 : -0.35;
  group.add(title);
  scene.add(group);
}

function addNodes(group, metrics, hitTargets, size, stats) {
  const sphereGeo = new THREE.SphereGeometry(1, 20, 14);
  for (const metric of metrics) {
    const pos = metricPosition(metric, size, stats);
    const color = genreColor(metric.play.genre || metric.play.theme || metric.themeLabel);
    const radius = 0.09 + metric.nodeSize * 0.12;
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.16 + metric.confidence * 0.18,
      roughness: 0.42,
      transparent: true,
      opacity: 0.58 + metric.confidence * 0.34
    });
    const node = new THREE.Mesh(sphereGeo, mat);
    node.position.copy(pos);
    node.scale.setScalar(radius);
    node.userData.metric = metric;
    node.userData.baseScale = node.scale.clone();
    node.userData.baseEmissive = mat.emissiveIntensity;
    group.add(node);
    hitTargets.push(node);
  }
}

function addProjectionMarks(group, metrics, size, stats) {
  const projectionGeo = new THREE.SphereGeometry(0.034, 10, 8);
  const materials = {
    theme: new THREE.MeshBasicMaterial({ color: 0xe8c06c, transparent: true, opacity: 0.23, depthWrite: false }),
    relation: new THREE.MeshBasicMaterial({ color: 0xa8c6bb, transparent: true, opacity: 0.2, depthWrite: false }),
    narrative: new THREE.MeshBasicMaterial({ color: 0xe1a476, transparent: true, opacity: 0.2, depthWrite: false })
  };
  for (const metric of metrics) {
    const projections = projectionPositions(metric, size, stats);
    for (const type of ["theme", "relation", "narrative"]) {
      const dot = new THREE.Mesh(projectionGeo, materials[type]);
      dot.position.copy(projections[type]);
      group.add(dot);
    }
  }
}

function addEdges(group, edges, size, stats) {
  const colors = {
    theme: 0xe8c06c,
    relation: 0xa8c6bb,
    narrative: 0xe1a476
  };
  const edgeObjects = [];
  for (const edge of edges) {
    const baseOpacity = edge.type === "theme" ? 0.24 : 0.19;
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        metricPosition(edge.source, size, stats),
        metricPosition(edge.target, size, stats)
      ]),
      new THREE.LineBasicMaterial({ color: colors[edge.type], transparent: true, opacity: baseOpacity })
    );
    line.userData.edge = edge;
    line.userData.baseOpacity = baseOpacity;
    group.add(line);
    edgeObjects.push(line);
  }
  return edgeObjects;
}

function setEdgeFocus(edgeObjects, playId) {
  for (const line of edgeObjects) {
    const edge = line.userData.edge;
    const connected = playId && (edge.source.play.play_id === playId || edge.target.play.play_id === playId);
    line.material.opacity = playId ? (connected ? 0.82 : 0.035) : line.userData.baseOpacity;
  }
}

function updateProjectionTethers(group, metric, size, stats) {
  for (const child of group.children) {
    child.geometry?.dispose?.();
    child.material?.dispose?.();
  }
  group.clear();
  if (!metric) return;
  const origin = metricPosition(metric, size, stats);
  const projections = projectionPositions(metric, size, stats);
  const configs = [
    { type: "theme", color: 0xe8c06c },
    { type: "relation", color: 0xa8c6bb },
    { type: "narrative", color: 0xe1a476 }
  ];
  for (const config of configs) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([origin, projections[config.type]]),
      new THREE.LineBasicMaterial({ color: config.color, transparent: true, opacity: 0.58 })
    );
    group.add(line);
  }
}

function metricPosition(metric, size, stats) {
  const spread = size * 1.38;
  const limit = size * 0.5;
  const x = clampRange((metric.themeStrength - stats.avgTheme) * spread + metric.jitter.x, -limit, limit);
  const y = clampRange((metric.narrativeStrength - stats.avgNarrative) * spread + metric.jitter.y, -limit, limit);
  const z = clampRange((metric.relationStrength - stats.avgRelation) * spread + metric.jitter.z, -limit, limit);
  return new THREE.Vector3(
    x,
    y,
    z
  );
}

function projectionPositions(metric, size, stats) {
  const half = size / 2;
  const pos = metricPosition(metric, size, stats);
  return {
    theme: new THREE.Vector3(-half, pos.y, pos.z),
    relation: new THREE.Vector3(pos.x, pos.y, -half),
    narrative: new THREE.Vector3(pos.x, -half, pos.z)
  };
}

function buildPlayMetrics(play) {
  const visual = play.visualLabel || {};
  const topic = play.topic || {};
  const network = play.network || {};
  const narrative = topic.narrative_structure || {};
  const themes = topic.themes || [];
  const primaryTheme = themes[0] || {};
  const rhythm = narrative.rhythm_curve || [];
  const density = Number(visual.y_relation?.density ?? network.network_metrics?.density ?? 0);
  const roleCount = Number(network.network_metrics?.node_count || network.nodes?.length || 0);
  const pageCount = Number(play.page_count || 0);
  const themeStrength = clamp01(Number(visual.x_theme?.confidence ?? primaryTheme.weight ?? 0.45));
  const relationStrength = clamp01(Number.isFinite(density) && density > 0 ? density : Number(visual.y_relation?.confidence ?? 0.45));
  const narrativeStrength = clamp01(Number(visual.z_narrative?.confidence ?? average(rhythm.map((p) => Number(p.tension))) ?? 0.45));
  const confidence = clamp01(Number(visual.label_confidence ?? average([themeStrength, relationStrength, narrativeStrength])));
  return {
    play,
    themeLabel: visual.x_theme?.label || play.theme || primaryTheme.theme || "主题待辨",
    relationLabel: visual.y_relation?.label || play.relation || network.network_metrics?.structure_type || "关系待辨",
    narrativeLabel: visual.z_narrative?.label || play.narrative || narrative.pattern || "叙事待辨",
    keywords: unique([...(visual.x_theme?.keywords || []), ...(visual.x_theme?.evidence || []), ...(primaryTheme.keywords || [])]).slice(0, 10),
    centralRoles: unique([...(visual.y_relation?.central_roles || []), ...(network.network_metrics?.central_roles || [])]).slice(0, 8),
    rhythm: rhythm.map((p) => Number(p.tension)).filter(Number.isFinite),
    density: clamp01(density),
    themeStrength,
    relationStrength,
    narrativeStrength,
    confidence,
    nodeSize: clamp01(Math.sqrt(Math.max(pageCount, roleCount, 1)) / 7),
    jitter: jitterFromId(play.play_id)
  };
}

function renderLayer3ReuseViews(cell, model, state, activeAxis) {
  const playIds = new Set((cell?.plays || []).map((play) => play.play_id));
  const partialModel = {
    ...model,
    roleTable: (model.roleTable || []).filter((role) => playIds.has(role.play_id))
  };
  drawAxisOverview(
    d3.select("#layer3-axis-overview"),
    model,
    state,
    activeAxis,
    AXIS_META[activeAxis] || AXIS_META.theme
  );
  drawRoleAttributeSankey(
    d3.select("#layer3-role-sankey"),
    partialModel.roleTable,
    state
  );
}

function buildTriadEdges(metrics) {
  const candidates = { theme: [], relation: [], narrative: [] };
  for (let i = 0; i < metrics.length; i += 1) {
    for (let j = i + 1; j < metrics.length; j += 1) {
      const a = metrics[i];
      const b = metrics[j];
      const themeScore = jaccard(a.keywords, b.keywords);
      if (themeScore >= 0.22) candidates.theme.push({ type: "theme", source: a, target: b, score: themeScore });
      const relationScore = 1 - Math.abs(a.density - b.density);
      if (relationScore >= 0.88) candidates.relation.push({ type: "relation", source: a, target: b, score: relationScore });
      const narrativeScore = rhythmSimilarity(a.rhythm, b.rhythm);
      if (narrativeScore >= 0.72) candidates.narrative.push({ type: "narrative", source: a, target: b, score: narrativeScore });
    }
  }
  return [
    ...topEdges(candidates.theme, 80),
    ...topEdges(candidates.relation, 70),
    ...topEdges(candidates.narrative, 70)
  ];
}

function topEdges(edges, limit) {
  return edges.sort((a, b) => b.score - a.score).slice(0, limit);
}

function buildCellStats(cell) {
  const metrics = (cell?.plays || []).map(buildPlayMetrics);
  return {
    count: metrics.length,
    avgTheme: average(metrics.map((m) => m.themeStrength)),
    avgRelation: average(metrics.map((m) => m.relationStrength)),
    avgNarrative: average(metrics.map((m) => m.narrativeStrength))
  };
}

function showTooltip(tooltip, metric, event) {
  if (!tooltip || !metric) return;
  tooltip.innerHTML = `
    <strong>${escapeHtml(metric.play.title || metric.play.play_id)}</strong>
    <span>主题：${escapeHtml(metric.themeLabel)} · ${formatPct(metric.themeStrength)}</span>
    <span>关系：${escapeHtml(metric.relationLabel)} · ${formatPct(metric.relationStrength)}</span>
    <span>叙事：${escapeHtml(metric.narrativeLabel)} · ${formatPct(metric.narrativeStrength)}</span>
    <em>${escapeHtml(metric.keywords.slice(0, 5).join(" / ") || "关键词待辨")} ｜ ${escapeHtml(metric.centralRoles.slice(0, 4).join(" / ") || "中心角色待辨")}</em>
  `;
  tooltip.style.display = "block";
  const boxWidth = 280;
  tooltip.style.left = `${Math.min(event.clientX + 16, window.innerWidth - boxWidth - 12)}px`;
  tooltip.style.top = `${Math.max(10, Math.min(event.clientY - 8, window.innerHeight - 134))}px`;
}

function axisButton(axis, activeAxis) {
  const meta = AXIS_META[axis];
  return `<button type="button" class="${axis === activeAxis ? "active" : ""}" style="--axis-color:${meta.color}" onclick="setLayer3Axis('${axis}')">${meta.label}</button>`;
}

function makeLabel(text, color, fontSize = 28) {
  const c = document.createElement("canvas");
  c.width = 520;
  c.height = 96;
  const ctx = c.getContext("2d");
  ctx.font = `800 ${fontSize}px "Microsoft YaHei","PingFang SC",sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(0,0,0,0.86)";
  ctx.strokeText(text, c.width / 2, c.height / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(2.8, 0.52, 1);
  return sprite;
}

function genreColor(key) {
  const palette = [0xd96f73, 0xe7b957, 0x5fb4b8, 0x78a6dc, 0xc5a0d8, 0x7fbd8a, 0xd59a66, 0xb9c98b];
  let hash = 0;
  for (const ch of String(key || "")) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return new THREE.Color(palette[hash % palette.length]);
}

function rhythmSimilarity(a, b) {
  if (!a.length || !b.length) return 0;
  const steps = 8;
  let total = 0;
  for (let i = 0; i < steps; i += 1) {
    const av = sampled(a, i / (steps - 1));
    const bv = sampled(b, i / (steps - 1));
    total += Math.abs(av - bv);
  }
  return clamp01(1 - total / steps);
}

function sampled(values, t) {
  if (!values.length) return 0;
  if (values.length === 1) return clamp01(values[0]);
  const pos = t * (values.length - 1);
  const i = Math.floor(pos);
  const f = pos - i;
  const a = clamp01(values[i]);
  const b = clamp01(values[Math.min(values.length - 1, i + 1)]);
  return a + (b - a) * f;
}

function jitterFromId(id) {
  let hash = 2166136261;
  for (const ch of String(id || "")) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const unit = (shift) => (((hash >>> shift) & 255) / 255 - 0.5) * 0.72;
  return { x: unit(0), y: unit(8), z: unit(16) };
}

function jaccard(a, b) {
  const aa = new Set((a || []).filter(Boolean));
  const bb = new Set((b || []).filter(Boolean));
  if (!aa.size || !bb.size) return 0;
  let overlap = 0;
  for (const item of aa) if (bb.has(item)) overlap += 1;
  return overlap / new Set([...aa, ...bb]).size;
}

function average(values) {
  const nums = (values || []).map(Number).filter(Number.isFinite);
  if (!nums.length) return 0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
}

function clampRange(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : 0));
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function shortLabel(label, limit) {
  const text = String(label || "");
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function formatPct(value) {
  return `${Math.round(clamp01(value) * 100)}%`;
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
