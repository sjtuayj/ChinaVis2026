import { renderLayer1 } from "./layer1.js?v=treemap-20260604x";
import { renderLayer2 } from "./layer2.js?v=treemap-20260604x";
import { renderLayer3 } from "./layer3.js?v=treemap-20260604x";
import { renderLayer4 } from "./layer4.js?v=treemap-20260604x";

const app = document.querySelector("#app");

const initialLayer4ContextView = new URLSearchParams(window.location.search).get("context");

const state = {
  layer: 1,
  selectedPlayId: "01001001",
  selectedPlayIds: ["01001001"],
  selectedCubeId: null,
  layer2Axis: "theme",
  layer2SankeyEra: "all",
  layer3Axis: "theme",
  cubeView: null,
  layer4ContextView: ["theme", "role", "narrative"].includes(initialLayer4ContextView)
    ? initialLayer4ContextView
    : "theme",
  roleNetworkZoomId: null
};
let layer2EnterTransition = false;
let layerTransitionTimer = null;

const model = {
  loaded: false,
  plays: [],
  roleTable: [],
  playsById: new Map(),
  cubeCells: [],
  cubeById: new Map(),
  themeTreeLayout: null,
  roleOverviewLayout: null,
  narrativeOverviewLayout: null
};

const helpers = {
  shell,
  navButton,
  cubePlaceholder,
  placeholder,
  getSelectedPlay,
  color
};

loadData().then(render);

async function loadData() {
  try {
    const [bundle, topicNarrative, roleNetworks, visualLabels, themeTreeLayout, roleOverviewLayout, narrativeOverviewLayout] = await Promise.all([
    fetch("./data/processed/visualization_bundle.json").then((res) => res.json()),
    fetch("./data/processed/topic_narrative_integrated.json").then((res) => res.json()),
    fetch("./data/processed/role_networks.json").then((res) => res.json()),
    fetchOptionalJson("./data/processed/visual_labels.json", null),
    fetchOptionalJson("./data/processed/theme_tree_layout.json", null),
    fetchOptionalJson("./data/processed/role_overview_layout.json", null),
    fetchOptionalJson("./data/processed/narrative_overview_layout.json", null)
  ]);

    const topicById = new Map(topicNarrative.map((item) => [item.play_id, item]));
    const networkById = new Map(roleNetworks.map((item) => [item.play_id, item]));
    const labelById = new Map((visualLabels?.play_labels || []).map((item) => [item.play_id, item]));

    model.plays = bundle.play_table.map((play) => {
      const topic = topicById.get(play.play_id);
      const network = networkById.get(play.play_id);
      const visualLabel = labelById.get(play.play_id);
      const theme = visualLabel?.x_theme?.label || topic?.themes?.[0]?.theme || "主题待分析";
      const relation = visualLabel?.y_relation?.label || network?.network_metrics?.structure_type || "角色关系待分析";
      const narrative = visualLabel?.z_narrative?.label || topic?.narrative_structure?.pattern || "叙事结构待分析";
      const cubeId = `${theme} | ${relation} | ${narrative}`;

      return {
        ...play,
        theme,
        relation,
        narrative,
        cubeId,
        visualLabel,
        topic,
        network
      };
    });

    model.roleTable = bundle.role_table || [];
    model.playsById = new Map(model.plays.map((play) => [play.play_id, play]));
    model.cubeCells = buildCubeCells(model.plays);
    model.cubeById = new Map(model.cubeCells.map((cell) => [cell.id, cell]));
    model.themeTreeLayout = themeTreeLayout;
    model.roleOverviewLayout = roleOverviewLayout;
    model.narrativeOverviewLayout = narrativeOverviewLayout;
    state.selectedCubeId = model.playsById.get(state.selectedPlayId)?.cubeId || model.cubeCells[0]?.id;
    state.selectedPlayIds = state.selectedPlayIds.filter((id) => model.playsById.has(id));
    if (!state.selectedPlayIds.length && model.plays.length) state.selectedPlayIds = [model.plays[0].play_id];
    state.selectedPlayId = state.selectedPlayIds[state.selectedPlayIds.length - 1] || state.selectedPlayId;
    model.loaded = true;
  } catch (error) {
    console.warn("数据加载失败，将仅展示页面框架。", error);
  }
}

async function fetchOptionalJson(url, fallback) {
  try {
    const response = await fetch(url);
    if (!response.ok) return fallback;
    return response.json();
  } catch {
    return fallback;
  }
}

function buildCubeCells(plays) {
  const map = new Map();
  for (const play of plays) {
    if (!map.has(play.cubeId)) {
      map.set(play.cubeId, {
        id: play.cubeId,
        theme: play.theme,
        relation: play.relation,
        narrative: play.narrative,
        plays: []
      });
    }
    map.get(play.cubeId).plays.push(play);
  }
  return [...map.values()].sort((a, b) => b.plays.length - a.plays.length);
}

function setState(next) {
  Object.assign(state, next);
  render();
}

function transitionLayer1ToLayer2(axis) {
  if (layerTransitionTimer) window.clearTimeout(layerTransitionTimer);
  const sceneWrap = app.querySelector(".page--layer1 .layer1-scene-wrap");
  const canvas = sceneWrap?.querySelector("canvas");
  if (!sceneWrap || !canvas) {
    setState({ layer: 2, layer2Axis: axis });
    return;
  }
  const sourceRect = sceneWrap.getBoundingClientRect();
  const ghost = createLayer1CubeGhost(canvas, sourceRect);

  layer2EnterTransition = true;
  setState({ layer: 2, layer2Axis: axis });

  window.requestAnimationFrame(() => {
    const page2 = app.querySelector(".page--layer2");
    page2?.classList.add("layer2-enter-from-layer1", `layer2-enter-from-layer1--${axis}`);
    animateLayer1CubeGhost(ghost, sourceRect, page2?.querySelector(".layer2-cube-card")?.getBoundingClientRect());
  });

  layerTransitionTimer = window.setTimeout(() => {
    app.querySelector(".page--layer2")?.classList.remove(
      "layer2-enter-from-layer1",
      "layer2-enter-from-layer1--theme",
      "layer2-enter-from-layer1--relation",
      "layer2-enter-from-layer1--narrative"
    );
    ghost?.remove();
    layer2EnterTransition = false;
    layerTransitionTimer = null;
  }, 920);
}

function createLayer1CubeGhost(canvas, rect) {
  return createLayerTransitionGhost(captureLayer1Snapshot(canvas, rect));
}

function captureLayer1Snapshot(canvas, rect) {
  let url = "";
  try {
    url = canvas.toDataURL("image/png");
  } catch {
    url = "";
  }
  return {
    url,
    rect: {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    }
  };
}

function createLayerTransitionGhost(snapshot) {
  if (!snapshot?.url || !snapshot?.rect) return null;
  const ghost = document.createElement("div");
  ghost.className = "layer-transition-cube-ghost";
  const rect = snapshot.rect;
  Object.assign(ghost.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`
  });

  const img = document.createElement("img");
  img.src = snapshot.url;
  ghost.appendChild(img);
  document.body.appendChild(ghost);
  return ghost;
}

function animateLayer1CubeGhost(ghost, sourceRect, targetRect) {
  if (!ghost || !targetRect) return;
  const targetScaleX = targetRect.width / Math.max(sourceRect.width, 1);
  const targetScaleY = targetRect.height / Math.max(sourceRect.height, 1);
  const targetX = targetRect.left - sourceRect.left;
  const targetY = targetRect.top - sourceRect.top;
  ghost.animate([
    {
      transform: "translate3d(0, 0, 0) scale(1, 1)",
      opacity: 1,
      filter: "none"
    },
    {
      offset: 0.82,
      transform: `translate3d(${targetX * 0.9}px, ${targetY * 0.9}px, 0) scale(${targetScaleX * 1.07}, ${targetScaleY * 1.07})`,
      opacity: 0.96,
      filter: "none"
    },
    {
      offset: 0.92,
      transform: `translate3d(${targetX * 0.98}px, ${targetY * 0.98}px, 0) scale(${targetScaleX * 1.015}, ${targetScaleY * 1.015})`,
      opacity: 0.34,
      filter: "brightness(0.94) saturate(0.9)"
    },
    {
      transform: `translate3d(${targetX}px, ${targetY}px, 0) scale(${targetScaleX}, ${targetScaleY})`,
      opacity: 0,
      filter: "brightness(0.9) saturate(0.85)"
    }
  ], {
    duration: 820,
    easing: "cubic-bezier(0.2, 0.82, 0.18, 1)",
    fill: "forwards"
  });
}

function transitionLayer2ToLayer1() {
  if (layerTransitionTimer) window.clearTimeout(layerTransitionTimer);
  const page = app.querySelector(".page--layer2");
  const cubeCard = page?.querySelector(".layer2-cube-card");
  if (!page || !cubeCard) {
    setState({ layer: 1 });
    return;
  }

  const ghost = createLayerTransitionPageGhost(page);
  const sourceRect = cubeCard.getBoundingClientRect();
  document.body.classList.add("layer-transition-lock");
  setState({ layer: 1 });
  prepareLayer1ReverseEnter(sourceRect, ghost);
}

function createLayerTransitionPageGhost(page) {
  const ghost = document.createElement("div");
  ghost.className = "layer-transition-page-ghost layer-transition-card-stage page--layer2";
  Object.assign(ghost.style, {
    pointerEvents: "none",
    zIndex: "120",
    background: "transparent",
    padding: "0",
    minHeight: "0"
  });

  [
    ".layer2-cube-card",
    ".layer2-overview-card",
    ".layer2-sankey-card",
    ".layer-back-button"
  ].forEach((selector) => {
    const source = page.querySelector(selector);
    const clone = cloneTransitionElement(source);
    if (clone) ghost.appendChild(clone);
  });

  document.body.appendChild(ghost);
  return ghost;
}

function cloneTransitionElement(source) {
  if (!source) return null;
  const rect = source.getBoundingClientRect();
  const clone = source.cloneNode(true);
  clone.classList.add("layer-transition-card-ghost");
  clone.style.position = "absolute";
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.margin = "0";
  clone.style.transform = "translate3d(0, 0, 0)";
  clone.style.opacity = "1";
  clone.style.pointerEvents = "none";

  const sourceCanvases = [...source.querySelectorAll("canvas")];
  const cloneCanvases = [...clone.querySelectorAll("canvas")];
  cloneCanvases.forEach((canvas, index) => {
    const sourceCanvas = sourceCanvases[index];
    if (!sourceCanvas) return;
    const image = document.createElement("img");
    image.className = canvas.className || "";
    image.id = canvas.id || "";
    Object.assign(image.style, {
      display: "block",
      width: "100%",
      height: "100%",
      objectFit: "fill"
    });
    try {
      image.src = sourceCanvas.toDataURL("image/png");
    } catch {
      image.alt = "";
    }
    canvas.replaceWith(image);
  });

  return clone;
}

function prepareLayer1ReverseEnter(sourceRect, ghost) {
  const page1 = app.querySelector(".page--layer1");
  const sceneWrap = page1?.querySelector(".layer1-scene-wrap");
  if (!page1 || !sceneWrap || !sourceRect) {
    ghost?.remove();
    document.body.classList.remove("layer-transition-lock");
    return;
  }

  const targetRect = sceneWrap.getBoundingClientRect();
  const scaleX = sourceRect.width / Math.max(targetRect.width, 1);
  const scaleY = sourceRect.height / Math.max(targetRect.height, 1);
  const translateX = sourceRect.left - targetRect.left;
  const translateY = sourceRect.top - targetRect.top;
  const startTransform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${scaleX}, ${scaleY})`;

  page1.classList.add("layer1-enter-from-layer2");
  sceneWrap.style.transformOrigin = "top left";
  sceneWrap.style.willChange = "transform, opacity, filter";
  sceneWrap.style.transform = startTransform;
  sceneWrap.style.opacity = "1";
  sceneWrap.style.filter = "none";

  window.requestAnimationFrame(() => {
    startLayer2ExitGhost(ghost);
    sceneWrap.animate([
      {
        transform: startTransform,
        opacity: 1,
        filter: "none"
      },
      {
        transform: "translate3d(0, 0, 0) scale(1, 1)",
        opacity: 1,
        filter: "none"
      }
    ], {
      duration: 820,
      easing: "cubic-bezier(0.2, 0.82, 0.18, 1)",
      fill: "both"
    });

    layerTransitionTimer = window.setTimeout(() => {
      ghost?.remove();
      sceneWrap.style.transform = "";
      sceneWrap.style.opacity = "";
      sceneWrap.style.filter = "";
      sceneWrap.style.transformOrigin = "";
      sceneWrap.style.willChange = "";
      page1.classList.remove("layer1-enter-from-layer2");
      document.body.classList.remove("layer-transition-lock");
      layerTransitionTimer = null;
    }, 860);
  });
}

function startLayer2ExitGhost(ghost) {
  if (!ghost) return;
  ghost.getBoundingClientRect();

  const cube = ghost.querySelector(".layer2-cube-card");
  const overview = ghost.querySelector(".layer2-overview-card");
  const sankey = ghost.querySelector(".layer2-sankey-card");
  const backButton = ghost.querySelector(".layer-back-button");

  if (cube) {
    cube.animate([
      { opacity: 1 },
      { opacity: 0 }
    ], {
      duration: 120,
      easing: "ease",
      fill: "forwards"
    });
  }

  if (overview) {
    overview.animate([
      { transform: "translate3d(0, 0, 0)", opacity: 1 },
      { transform: "translate3d(96px, 0, 0)", opacity: 0 }
    ], {
      duration: 760,
      easing: "cubic-bezier(0.2, 0.82, 0.18, 1)",
      fill: "forwards"
    });
  }

  if (sankey) {
    sankey.animate([
      { transform: "translate3d(0, 0, 0)", opacity: 1 },
      { transform: "translate3d(0, 70px, 0)", opacity: 0 }
    ], {
      duration: 820,
      easing: "cubic-bezier(0.2, 0.82, 0.18, 1)",
      fill: "forwards"
    });
  }

  if (backButton) {
    backButton.animate([
      { transform: "translate3d(0, 0, 0)", opacity: 1 },
      { transform: "translate3d(-10px, 0, 0)", opacity: 0 }
    ], {
      duration: 220,
      easing: "ease",
      fill: "forwards"
    });
  }
}

window.state = state;
window.goLayer = (layer) => setState({ layer });
window.backLayer2ToLayer1 = () => transitionLayer2ToLayer1();
window.openLayer2Axis = (axis) => {
  if (!["theme", "relation", "narrative"].includes(axis)) return;
  if (state.layer === 1) {
    transitionLayer1ToLayer2(axis);
    return;
  }
  setState({ layer: 2, layer2Axis: axis });
};
window.setLayer2SankeyEra = (era) => setState({ layer2SankeyEra: era || "all" });
window.openLayer3Cube = (cubeId) => {
  const cell = model.cubeById.get(cubeId);
  if (!cell?.plays?.length) return;
  const nextLayer3Axis = state.layer === 2 && ["theme", "relation", "narrative"].includes(state.layer2Axis)
    ? state.layer2Axis
    : state.layer3Axis;
  setState({
    layer: 3,
    selectedCubeId: cell.id,
    layer3Axis: nextLayer3Axis
  });
};
window.setLayer3Axis = (axis) => {
  if (!["theme", "relation", "narrative"].includes(axis)) return;
  setState({ layer3Axis: axis });
};
window.toggleLayer3Summary = (button) => {
  const summary = button?.closest?.(".layer3-cell-summary");
  if (!summary) return;
  const collapsed = summary.classList.toggle("collapsed");
  button.textContent = collapsed ? "展开" : "收起";
  button.setAttribute("aria-label", collapsed ? "展开说明" : "收起说明");
};
window.openLayer3Play = (playId, axis = state.layer3Axis || "theme") => {
  const play = model.playsById.get(playId);
  if (!play) return;
  const contextView = axis === "relation" ? "role" : axis;
  setState({
    layer: 4,
    selectedPlayId: playId,
    selectedPlayIds: [playId],
    selectedCubeId: play.cubeId || state.selectedCubeId,
    layer4ContextView: ["theme", "role", "narrative"].includes(contextView) ? contextView : "theme"
  });
};
window.openPlay = (playId) => {
  const play = model.playsById.get(playId);
  setState({
    layer: 4,
    selectedPlayId: playId,
    selectedPlayIds: [playId],
    selectedCubeId: play?.cubeId || state.selectedCubeId
  });
};
window.toggleLayer4Play = (playId) => {
  if (!model.playsById.has(playId)) return;

  const maxSelected = 4;
  const selected = [...state.selectedPlayIds];
  const existingIndex = selected.indexOf(playId);

  if (existingIndex >= 0) {
    if (selected.length === 1) return;
    selected.splice(existingIndex, 1);
    const nextMain = state.selectedPlayId === playId ? selected[selected.length - 1] : state.selectedPlayId;
    const nextPlay = model.playsById.get(nextMain);
    // If zoomed on the deselected play, switch zoom to nextMain
    const nextZoom = state.roleNetworkZoomId === playId ? nextMain : state.roleNetworkZoomId;
    setState({
      selectedPlayId: nextMain,
      selectedPlayIds: selected,
      selectedCubeId: nextPlay?.cubeId || state.selectedCubeId,
      roleNetworkZoomId: nextZoom
    });
    return;
  }

  selected.push(playId);
  while (selected.length > maxSelected) selected.shift();
  const play = model.playsById.get(playId);
  setState({
    selectedPlayId: playId,
    selectedPlayIds: selected,
    selectedCubeId: play?.cubeId || state.selectedCubeId
  });
};
window.setLayer4ContextView = (view) => {
  if (!["theme", "role", "narrative"].includes(view)) return;
  setState({ layer4ContextView: view });
};
window.zoomRoleNetwork = (playId) => setState({ roleNetworkZoomId: playId });
window.unzoomRoleNetwork = () => setState({ roleNetworkZoomId: null });
window.zoomRoleNetworkStep = (direction) => {
  const ids = state.selectedPlayIds;
  if (!ids.length) return;
  const current = state.roleNetworkZoomId || ids[0];
  const idx = ids.indexOf(current);
  if (idx < 0) { setState({ roleNetworkZoomId: ids[0] }); return; }
  const next = ids[(idx + direction + ids.length) % ids.length];
  setState({ roleNetworkZoomId: next });
};

function render() {
  const context = { app, state, model, helpers };
  if (state.layer === 1) renderLayer1(context);
  if (state.layer === 2) renderLayer2(context);
  if (state.layer === 3) renderLayer3(context);
  if (state.layer === 4) renderLayer4(context);
  if (state.layer === 2 && layer2EnterTransition) {
    app.querySelector(".page--layer2")?.classList.add("layer2-enter-from-layer1");
  }
}

function shell(title, description, content) {
  app.innerHTML = `
    <main class="page">
      <header class="topbar">
        <div>
          <h1>${title}</h1>
          <p>${description}</p>
        </div>
        <nav class="nav">
          ${navButton(1, "第一层")}
          ${navButton(2, "第二层")}
          ${navButton(3, "第三层")}
          ${navButton(4, "第四层")}
        </nav>
      </header>
      ${content}
    </main>
  `;
}

function navButton(layer, label) {
  return `<button class="${state.layer === layer ? "active" : ""}" onclick="goLayer(${layer})">${label}</button>`;
}

function cubePlaceholder(text) {
  const cells = Array.from({ length: 25 }, (_, index) => `<div class="cube-cell ${index % 6 === 0 ? "hot" : ""}"></div>`).join("");
  return `
    <div class="placeholder">
      <div>
        <div class="cube-sketch">${cells}</div>
        <p>${text}</p>
      </div>
    </div>
  `;
}

function placeholder(text) {
  return `<div class="placeholder">${text}</div>`;
}

function getSelectedPlay() {
  return model.playsById.get(state.selectedPlayId) || model.plays[0];
}

function color(index) {
  return ["#a83e43", "#d3a13a", "#2f6f73", "#365f91", "#7a5aa6", "#bf6b3f", "#4e7f9f"][index % 7];
}
