// 第四层：单个剧本
// 只改这一层：左上总图上下文、右上当前剧本角色网络、底部叙事时序图。

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

export function renderLayer4({ app, model, state, helpers }) {
  const { getSelectedPlay } = helpers;
  const play = getSelectedPlay();
  const selectedPlayIds = state.selectedPlayIds?.length ? state.selectedPlayIds : [play?.play_id].filter(Boolean);
  const selectedPlays = selectedPlayIds.map((id) => model.playsById.get(id)).filter(Boolean);
  const contextView = state.layer4ContextView || "theme";

  // Build DOM structure only on first render; subsequent renders update SVGs in-place
  if (!app.querySelector(".layer4-grid")) {
    app.innerHTML = `
      <main class="page page--layer4">
        <section class="layer4-grid">
          <div class="card context-overview-card">
            <div class="slot">
              <svg id="context-overview" viewBox="0 0 900 900" preserveAspectRatio="xMidYMid meet"></svg>
            </div>
          </div>
          <div class="card current-role-card">
            <div class="slot" id="role-network-slot">
              <svg id="role-network" viewBox="0 0 860 500" preserveAspectRatio="xMidYMid meet"></svg>
            </div>
          </div>
          <div class="card narrative-card">
            <div class="slot">
              <svg id="narrative-chart" viewBox="0 0 1260 620" preserveAspectRatio="xMidYMid meet"></svg>
            </div>
          </div>
        </section>
        <button type="button" class="layer-back-button" onclick="goLayer(3)" aria-label="返回第三层">
          <span class="layer-back-icon" aria-hidden="true"></span>
          <span class="layer-back-eyebrow">返回</span>
          <span class="layer-back-text">第三层总览</span>
        </button>
      </main>
    `;
  }

  drawContextOverview(play, model, contextView, selectedPlayIds);
  drawRoleNetwork(selectedPlays, helpers, state.roleNetworkZoomId);
  drawNarrativeTimeline(selectedPlays, helpers);
}

function drawContextOverview(play, model, view, selectedPlayIds) {
  const svg = d3.select("#context-overview");

  const prevView = svg.attr("data-view");
  const viewChanged = prevView && prevView !== view;
  svg.attr("data-view", view).attr("data-play", play?.play_id || "");

  // Remove zoom from force-graph views when not needed
  if (view !== "role" && view !== "narrative") svg.on(".zoom", null);

  const hasContent = svg.selectAll("*").size() > 0;

  if (hasContent && viewChanged) {
    // 视图类型切换：淡出 → 全量重绘 → 淡入
    svg.interrupt();
    svg.transition().duration(150).style("opacity", 0).on("end", () => {
      svg.selectAll("*").remove();
      svg.style("opacity", null);
      fullDraw(svg, view, play, model, selectedPlayIds);
      svg.style("opacity", 0).transition().duration(250).style("opacity", null);
    });
  } else if (!hasContent) {
    // 首次渲染：全量绘制
    fullDraw(svg, view, play, model, selectedPlayIds);
  } else if (view === "theme" && model.themeTreeLayout) {
    updateThemeTree(svg, model.themeTreeLayout, model, play, selectedPlayIds);
  } else if (view === "role" && model.roleOverviewLayout) {
    updatePrecomputedOverview(svg, model.roleOverviewLayout, play, selectedPlayIds, model);
  } else if (view === "narrative" && model.narrativeOverviewLayout) {
    updatePrecomputedOverview(svg, model.narrativeOverviewLayout, play, selectedPlayIds, model);
  } else {
    svg.selectAll("*").remove();
    fullDraw(svg, view, play, model, selectedPlayIds);
  }
}

function fullDraw(svg, view, play, model, selectedPlayIds) {
  if (view === "role") {
    if (model.roleOverviewLayout) {
      drawPrecomputedOverview(svg, model.roleOverviewLayout, play, selectedPlayIds, model);
    } else {
      drawRoleOverview(svg, play, model, selectedPlayIds);
    }
  } else if (view === "narrative") {
    if (model.narrativeOverviewLayout) {
      drawPrecomputedOverview(svg, model.narrativeOverviewLayout, play, selectedPlayIds, model);
    } else {
      drawNarrativeOverview(svg, play, model, selectedPlayIds);
    }
  } else {
    drawThemeTree(svg, play, model, selectedPlayIds);
  }
}

function updateThemeTree(svg, layout, model, play, selectedPlayIds) {
  const selected = new Set(selectedPlayIds);
  const activePlayId = play?.play_id;
  const center = layout.center || [450, 450];
  const pathActive = new Set();
  const focusedBranchIds = new Set();

  for (const leaf of layout.leaves || []) {
    if (leaf.play_id === activePlayId || selected.has(leaf.play_id)) {
      for (const linkIndex of leaf.path_ids || []) pathActive.add(linkIndex);
      for (const branchId of branchIdsFromThemePath(leaf.theme_path || [])) focusedBranchIds.add(branchId);
    }
  }

  svg.classed("theme-tree-has-focus", pathActive.size > 0);

  // Update link paths (class only — geometry is static)
  svg.selectAll(".life-link")
    .classed("theme-muted", (d) => !pathActive.has(d.index))
    .classed("link--selected", (d) => pathActive.has(d.index))
    .classed("link--active", false);

  svg.selectAll(".life-link-extension")
    .classed("theme-muted", (d) => !pathActive.has(d.index))
    .classed("link-extension--selected", (d) => pathActive.has(d.index))
    .classed("link-extension--active", false);

  // Update branch dots
  svg.selectAll(".theme-branch-dot")
    .classed("focus", (d) => focusedBranchIds.has(d.id))
    .classed("theme-muted", (d) => !focusedBranchIds.has(d.id));

  // Update leaf dots — radius + selection classes
  svg.selectAll(".theme-leaf-dot")
    .attr("r", (d) => (d.play_id === activePlayId ? 4.8 : selected.has(d.play_id) ? 4.0 : 2.6))
    .classed("selected", (d) => selected.has(d.play_id))
    .classed("active", (d) => d.play_id === activePlayId)
    .classed("focus", (d) => d.path_ids?.some((id) => pathActive.has(id)))
    .classed("theme-muted", (d) => !d.path_ids?.some((id) => pathActive.has(id)));

  // Update leaf labels
  svg.selectAll(".theme-leaf-dot + title")
    .text((d) => `${d.name}\n${d.theme_path?.join(" / ") || ""}`);

  svg.selectAll(".life-label")
    .classed("selected", (d) => selected.has(d.play_id))
    .classed("active", (d) => d.play_id === activePlayId);

  // Rebuild pinned labels
  svg.selectAll(".theme-pinned-labels").remove();
  const base = svg.select("g.theme-tree-base");
  if (!base.empty()) {
    drawPinnedLeafLabels(
      base, layout, selected, activePlayId,
      (layout.leaves || []).filter((d) => selected.has(d.play_id) || d.play_id === activePlayId)
    );
  }

  // Hide tooltip
  svg.select(".theme-leaf-tooltip").style("display", "none");

  // Update note count
  svg.select(".theme-tree-note")
    .text(`显示 ${(layout.leaves || []).length} / ${model.plays.length} 部`);
}

function drawPrecomputedOverview(svg, layout, play, selectedPlayIds, model) {
  const activePlayId = play?.play_id;
  const selected = new Set(selectedPlayIds);
  const vb = layout.viewBox || [0, 0, 900, 900];
  const width = vb[2] || 900;
  const height = vb[3] || 900;
  const center = layout.center || [width / 2, height / 2];
  const pathActive = new Set();
  const focusedBranchIds = new Set();

  for (const leaf of layout.leaves || []) {
    if (leaf.play_id === activePlayId || selected.has(leaf.play_id)) {
      for (const linkId of leaf.path_ids || []) pathActive.add(linkId);
      focusedBranchIds.add((layout.links || []).find((l) => l.idx === leaf.path_ids?.[0])?.source);
    }
  }

  svg.classed("theme-tree-has-focus", pathActive.size > 0);

  const base = svg.append("g").attr("class", "theme-tree-base").attr("transform", `translate(${center[0]},${center[1]})`);

  // Branch dots — smaller for inner ring, larger for middle ring
  base.append("g").selectAll("circle").data(layout.branches || []).join("circle")
    .attr("transform", (d) => d.transform)
    .attr("r", (d) => d.is_inner
      ? Math.min(3.5, 1.4 + Math.sqrt(d.total_count || 1) * 0.04)
      : Math.min(7.2, 2.6 + Math.sqrt(d.total_count || 1) * 0.1))
    .attr("class", (d) => ["theme-branch-dot", focusedBranchIds.has(d.id) ? "focus" : "theme-muted"].join(" "))
    .attr("fill", (d) => d.color);

  // Link lines
  const linkPaths = base.append("g").attr("fill", "none").selectAll("path").data(layout.links || []).join("path")
    .attr("class", (d) => ["life-link", pathActive.has(d.idx) ? "link--selected" : "theme-muted"].join(" "))
    .attr("stroke", (d) => d.color)
    .attr("d", (d) => d.path);

  // Leaf dots
  const leafG = base.append("g").selectAll("g").data(layout.leaves || []).join("g")
    .attr("transform", (d) => `rotate(${d.angle - 90}) translate(${layout.inner_radius},0)`);

  const leafNodeById = new Map();
  leafG.each(function (d) { leafNodeById.set(d.id, this); });

  leafG.append("circle")
    .attr("r", (d) => (d.play_id === activePlayId ? 4.8 : selected.has(d.play_id) ? 4.0 : 2.6))
    .attr("class", (d) => ["theme-leaf-dot", selected.has(d.play_id) ? "selected" : "",
      d.play_id === activePlayId ? "active" : "",
      d.path_ids?.some((id) => pathActive.has(id)) ? "focus" : "theme-muted"].join(" "))
    .attr("fill", (d) => d.color)
    .append("title").text((d) => `${d.name}\n${d.category || ""}`);

  // Leaf labels — only for selected/active (shown via pinned labels below)

  // Hit paths for hover/click
  svg.append("g").attr("class", "theme-leaf-cells").selectAll("path")
    .data(layout.leaves || []).join("path")
    .attr("class", "theme-leaf-cell")
    .attr("d", (d) => d.hit_path)
    .on("mouseover", (_, d) => setLeafFocus(d, true))
    .on("mouseout", (_, d) => setLeafFocus(d, false))
    .on("click", (event, d) => {
      event.stopPropagation();
      if (d.play_id) window.toggleLayer4Play(d.play_id);
    });

  // Tooltip
  const tooltip = svg.append("g").attr("class", "theme-leaf-tooltip").style("display", "none");
  tooltip.append("rect").attr("rx", 7).attr("ry", 7);
  tooltip.append("text").attr("class", "tooltip-title").attr("x", 12).attr("y", 10);
  tooltip.append("text").attr("class", "tooltip-theme").attr("x", 12).attr("y", 34);

  // Legend
  svg.append("g").attr("class", "theme-tree-legend").selectAll("g")
    .data(layout.legend || []).join("g")
    .attr("transform", (_, i) => `translate(24,${34 + i * 18})`)
    .call((item) => {
      item.append("circle").attr("r", 4).attr("fill", (d) => d.color);
      item.append("text").attr("x", 11).attr("y", 4).attr("fill", (d) => d.color)
        .text((d) => `${shortLabel(d.name, 6)} ${d.count}`);
    });

  // Note — with background rect for visibility
  const noteG = svg.append("g").attr("class", "theme-tree-note-group");
  const noteText = noteG.append("text").attr("x", width - 24).attr("y", height - 24)
    .attr("text-anchor", "end").attr("class", "theme-tree-note")
    .text(`显示 ${(layout.leaves || []).length} / ${model.plays.length} 部`);
  // Size the background after text is rendered
  const noteBox = noteText.node().getBBox();
  noteG.insert("rect", "text")
    .attr("x", noteBox.x - 6).attr("y", noteBox.y - 4)
    .attr("width", noteBox.width + 12).attr("height", noteBox.height + 8)
    .attr("rx", 4).attr("fill", "rgba(14,13,11,0.75)");

  // Pinned labels for selected
  drawPinnedLeafLabels(base, layout, selected, activePlayId,
    (layout.leaves || []).filter((d) => selected.has(d.play_id) || d.play_id === activePlayId));

  // Inner helpers
  function setHoverPath(leafDatum, active) {
    const hoverPath = new Set(leafDatum.path_ids || []);
    linkPaths.classed("link--active", (link) => active && hoverPath.has(link.idx));
  }

  function setLeafFocus(leafDatum, active) {
    const node = d3.select(leafNodeById.get(leafDatum.id));
    node.raise().select(".theme-leaf-dot").classed("label--active", active);
    node.select("text").classed("label--active", active);
    setHoverPath(leafDatum, active);
    if (active) showLeafTooltip(leafDatum);
    else tooltip.style("display", "none");
  }

  function showLeafTooltip(leafDatum) {
    const title = leafDatum.name || "";
    const catName = leafDatum.category || "";
    tooltip.raise().style("display", null);
    tooltip.select(".tooltip-title").text(shortLabel(title, 18));
    tooltip.select(".tooltip-theme").text(shortLabel(catName, 32));
    const tw = Math.max(118, tooltip.select(".tooltip-title").node().getBBox().width);
    tooltip.attr("transform", `translate(${width - Math.min(292, tw + 30)},40)`);
    tooltip.select("rect").attr("width", Math.min(292, tw + 30)).attr("height", 54);
  }
}

function updatePrecomputedOverview(svg, layout, play, selectedPlayIds, model) {
  const selected = new Set(selectedPlayIds);
  const activePlayId = play?.play_id;
  const pathActive = new Set();
  const focusedBranchIds = new Set();

  for (const leaf of layout.leaves || []) {
    if (leaf.play_id === activePlayId || selected.has(leaf.play_id)) {
      for (const linkId of leaf.path_ids || []) pathActive.add(linkId);
      focusedBranchIds.add((layout.links || []).find((l) => l.idx === leaf.path_ids?.[0])?.source);
    }
  }

  svg.classed("theme-tree-has-focus", pathActive.size > 0);

  svg.selectAll(".life-link")
    .classed("theme-muted", (d) => !pathActive.has(d.idx))
    .classed("link--selected", (d) => pathActive.has(d.idx));

  svg.selectAll(".theme-branch-dot")
    .classed("focus", (d) => focusedBranchIds.has(d.id))
    .classed("theme-muted", (d) => !focusedBranchIds.has(d.id));

  svg.selectAll(".theme-leaf-dot")
    .attr("r", (d) => (d.play_id === activePlayId ? 4.8 : selected.has(d.play_id) ? 4.0 : 2.6))
    .classed("selected", (d) => selected.has(d.play_id))
    .classed("active", (d) => d.play_id === activePlayId)
    .classed("focus", (d) => d.path_ids?.some((id) => pathActive.has(id)))
    .classed("theme-muted", (d) => !d.path_ids?.some((id) => pathActive.has(id)));

  svg.selectAll(".life-label")
    .classed("selected", (d) => selected.has(d.play_id))
    .classed("active", (d) => d.play_id === activePlayId);

  svg.selectAll(".theme-pinned-labels").remove();
  const base = svg.select("g.theme-tree-base");
  if (!base.empty()) {
    drawPinnedLeafLabels(base, layout, selected, activePlayId,
      (layout.leaves || []).filter((d) => selected.has(d.play_id) || d.play_id === activePlayId));
  }

  svg.select(".theme-leaf-tooltip").style("display", "none");
  const noteText = svg.select(".theme-tree-note")
    .text(`显示 ${(layout.leaves || []).length} / ${model.plays.length} 部`);
  const noteBox = noteText.node().getBBox();
  svg.select(".theme-tree-note-group rect")
    .attr("x", noteBox.x - 6).attr("y", noteBox.y - 4)
    .attr("width", noteBox.width + 12).attr("height", noteBox.height + 8);
}

function drawThemeTree(svg, play, model, selectedPlayIds) {
  if (model.themeTreeLayout) {
    drawPrecomputedThemeTree(svg, model.themeTreeLayout, model, play, selectedPlayIds);
    return;
  }

  const width = 900;
  const height = 900;
  const outerRadius = 430;
  const innerRadius = outerRadius - 104;
  const selected = new Set(selectedPlayIds);
  const data = buildThemeHierarchy(model.plays, selected, play?.play_id);

  const root = d3
    .hierarchy(data, (d) => d.branchset)
    .sum((d) => (d.branchset ? 0 : 1))
    .sort((a, b) => a.value - b.value || d3.ascending(a.data.order, b.data.order));

  d3.cluster().size([360, innerRadius]).separation(() => 1)(root);
  setRadius(root, (root.data.length = 0), innerRadius / maxLength(root));
  setColor(root);
  const themeColorLookup = buildThemeColorLookupFromHierarchy(root);

  const base = svg.append("g").attr("transform", `translate(${width / 2},${height / 2})`);
  const viewport = base.append("g");

  viewport
    .append("g")
    .attr("fill", "none")
    .selectAll("path")
    .data(root.links().filter((d) => !d.target.children))
    .join("path")
    .each(function (d) {
      d.target.linkExtensionNode = this;
    })
    .attr("class", "life-link-extension")
    .attr("stroke", (d) => themeLinkColor(d, themeColorLookup))
    .attr("d", linkExtensionConstant(innerRadius));

  const link = viewport
    .append("g")
    .attr("fill", "none")
    .selectAll("path")
    .data(root.links())
    .join("path")
    .each(function (d) {
      d.target.linkNode = this;
    })
    .attr("class", "life-link")
    .attr("stroke", (d) => themeLinkColor(d, themeColorLookup))
    .attr("d", linkConstant);

  viewport
    .append("g")
    .selectAll("g")
    .data(root.descendants().filter((d) => d.children && d.depth > 0))
    .join("g")
    .attr("transform", (d) => `rotate(${d.x - 90}) translate(${d.radius},0)`)
    .append("circle")
    .attr("r", (d) => Math.min(7.2, 2.6 + Math.sqrt(d.value || 1) * 0.1))
    .attr("class", (d) => ["theme-branch-dot", d.data.selected ? "selected" : "", d.data.active ? "active" : ""].join(" "))
    .attr("fill", (d) => d.color);

  const leaf = viewport
    .append("g")
    .selectAll("g")
    .data(root.leaves())
    .join("g")
    .attr("transform", (d) => `rotate(${d.x - 90}) translate(${innerRadius},0)`)
    .on("mouseover", mouseovered(true))
    .on("mouseout", mouseovered(false))
    .on("click", (event, d) => {
      event.stopPropagation();
      if (d.data.playId) window.toggleLayer4Play(d.data.playId);
    });

  leaf
    .append("circle")
    .attr("r", (d) => (d.data.active ? 4.8 : d.data.selected ? 4.0 : 2.6))
    .attr("class", (d) => ["theme-leaf-dot", d.data.selected ? "selected" : "", d.data.active ? "active" : ""].join(" "))
    .attr("fill", (d) => d.color)
    .append("title")
    .text((d) => `${d.data.name}\n${d.data.themePath?.join(" / ") || ""}`);

  leaf
    .append("text")
    .attr("dy", ".31em")
    .attr("x", 4.5)
    .attr("text-anchor", (d) => (d.x < 180 ? "start" : "end"))
    .attr("transform", (d) => (d.x < 180 ? "" : "rotate(180) translate(-9,0)"))
    .attr("class", (d) => {
      const classes = ["life-label"];
      if (d.data.selected) classes.push("selected");
      if (d.data.active) classes.push("active");
      return classes.join(" ");
    })
    .text((d) => d.data.name);

  svg
    .append("g")
    .attr("class", "theme-tree-legend")
    .selectAll("g")
    .data(root.children || [])
    .join("g")
    .attr("transform", (_, i) => `translate(24,${34 + i * 18})`)
    .call((item) => {
      item.append("circle").attr("r", 4).attr("fill", (d) => d.color);
      item
        .append("text")
        .attr("x", 11)
        .attr("y", 4)
        .attr("fill", (d) => d.color)
        .text((d) => `${shortLabel(d.data.name, 6)} ${d.data.totalCount || d.value}`);
    });

  svg
    .append("text")
    .attr("x", width - 24)
    .attr("y", height - 24)
    .attr("text-anchor", "end")
    .attr("class", "theme-tree-note")
    .text(`显示 ${root.leaves().length} / ${model.plays.length} 部`);

  root.leaves().filter((d) => d.data.selected).forEach(markSelectedPath);
  root.leaves().filter((d) => d.data.active).forEach(markSelectedPath);

  function mouseovered(active) {
    return function (_, d) {
      d3.select(this).select("circle").classed("label--active", active);
      d3.select(this).select("text").classed("label--active", active);
      if (d.data.selected) return;
      markHoverPath(d, active);
    };
  }

  function markSelectedPath(d) {
    d3.select(d.linkExtensionNode).classed("link-extension--selected", true).raise();
    do {
      d3.select(d.linkNode).classed("link--selected", true).raise();
    } while ((d = d.parent));
  }

  function markHoverPath(d, active) {
    d3.select(d.linkExtensionNode).classed("link-extension--active", active).raise();
    do {
      d3.select(d.linkNode).classed("link--active", active).raise();
    } while ((d = d.parent));
  }
}

function drawPrecomputedThemeTree(svg, layout, model, play, selectedPlayIds) {
  const [width, height] = [layout.viewBox?.[2] || 900, layout.viewBox?.[3] || 900];
  const selected = new Set(selectedPlayIds);
  const activePlayId = play?.play_id;
  const center = layout.center || [width / 2, height / 2];
  const pathActive = new Set();
  const focusedBranchIds = new Set();
  const themeColorLookup = buildThemeColorLookupFromLayout(layout);
  const links = (layout.links || []).map((link, index) => ({
    ...link,
    index,
    segmentColor: precomputedLinkColor(link, themeColorLookup)
  }));

  for (const leaf of layout.leaves || []) {
    if (leaf.play_id === activePlayId || selected.has(leaf.play_id)) {
      for (const linkIndex of leaf.path_ids || []) pathActive.add(linkIndex);
      for (const branchId of branchIdsFromThemePath(leaf.theme_path || [])) focusedBranchIds.add(branchId);
    }
  }

  svg.classed("theme-tree-has-focus", pathActive.size > 0);

  const base = svg.append("g").attr("class", "theme-tree-base").attr("transform", `translate(${center[0]},${center[1]})`);

  const extensionPaths = base
    .append("g")
    .attr("fill", "none")
    .selectAll("path")
    .data(links.filter((link) => link.extension_path))
    .join("path")
    .attr("class", (d) => ["life-link-extension", pathActive.has(d.index) ? "link-extension--selected" : "theme-muted"].join(" "))
    .attr("stroke", (d) => d.segmentColor)
    .attr("d", (d) => d.extension_path);

  const linkPaths = base
    .append("g")
    .attr("fill", "none")
    .selectAll("path")
    .data(links)
    .join("path")
    .attr("class", (d) => ["life-link", pathActive.has(d.index) ? "link--selected" : "theme-muted"].join(" "))
    .attr("stroke", (d) => d.segmentColor)
    .attr("d", (d) => d.path);

  const tooltip = svg.append("g").attr("class", "theme-leaf-tooltip").style("display", "none");
  tooltip.append("rect").attr("rx", 7).attr("ry", 7);
  tooltip.append("text").attr("class", "tooltip-title").attr("x", 12).attr("y", 10);
  tooltip.append("text").attr("class", "tooltip-theme").attr("x", 12).attr("y", 34);

  base
    .append("g")
    .selectAll("g")
    .data(layout.branches || [])
    .join("g")
    .attr("transform", (d) => d.transform)
    .append("circle")
    .attr("r", (d) => Math.min(7.2, 2.6 + Math.sqrt(d.total_count || 1) * 0.1))
    .attr("class", (d) => ["theme-branch-dot", focusedBranchIds.has(d.id) ? "focus" : "theme-muted"].join(" "))
    .attr("fill", (d) => d.color);

  const leaf = base
    .append("g")
    .selectAll("g")
    .data(layout.leaves || [])
    .join("g")
    .attr("transform", (d) => `rotate(${d.angle - 90}) translate(${layout.inner_radius},0)`);

  const leafNodeById = new Map();
  leaf.each(function (d) {
    leafNodeById.set(d.id, this);
  });

  leaf
    .append("circle")
    .attr("r", (d) => (d.play_id === activePlayId ? 4.8 : selected.has(d.play_id) ? 4.0 : 2.6))
    .attr("class", (d) => [
      "theme-leaf-dot",
      selected.has(d.play_id) ? "selected" : "",
      d.play_id === activePlayId ? "active" : "",
      d.path_ids?.some((id) => pathActive.has(id)) ? "focus" : "theme-muted"
    ].join(" "))
    .attr("fill", (d) => d.color)
    .append("title")
    .text((d) => `${d.name}\n${d.theme_path?.join(" / ") || ""}`);

  const leafPoints = layout.leaves || [];
  if (leafPoints.length) {
    svg
      .append("g")
      .attr("class", "theme-leaf-cells")
      .selectAll("path")
      .data(leafPoints)
      .join("path")
      .attr("class", "theme-leaf-cell")
      .attr("d", (d, index) => d.hit_path || fallbackLeafCellPath(leafPoints, index, center, layout.inner_radius))
      .on("mouseover", (_, d) => setLeafFocus(d, true))
      .on("mouseout", (_, d) => setLeafFocus(d, false))
      .on("click", (event, d) => {
        event.stopPropagation();
        if (d.play_id) window.toggleLayer4Play(d.play_id);
      });
  }

  svg
    .append("g")
    .attr("class", "theme-tree-legend")
    .selectAll("g")
    .data(layout.legend || [])
    .join("g")
    .attr("transform", (_, i) => `translate(24,${34 + i * 18})`)
    .call((item) => {
      item.append("circle").attr("r", 4).attr("fill", (d) => d.color);
      item
        .append("text")
        .attr("x", 11)
        .attr("y", 4)
        .attr("fill", (d) => d.color)
        .text((d) => `${shortLabel(d.name, 6)} ${d.count}`);
    });

  svg
    .append("text")
    .attr("x", width - 24)
    .attr("y", height - 24)
    .attr("text-anchor", "end")
    .attr("class", "theme-tree-note")
    .text(`显示 ${(layout.leaves || []).length} / ${model.plays.length} 部`);

  drawPinnedLeafLabels(base, layout, selected, activePlayId, (layout.leaves || []).filter((d) => selected.has(d.play_id) || d.play_id === activePlayId));

  function setHoverPath(leafDatum, active) {
    const hoverPath = new Set(leafDatum.path_ids || []);
    linkPaths.classed("link--active", (link) => active && hoverPath.has(link.index));
    extensionPaths.classed("link-extension--active", (link) => active && hoverPath.has(link.index));
  }

  function setLeafFocus(leafDatum, active) {
    const node = d3.select(leafNodeById.get(leafDatum.id));
    node.raise().select(".theme-leaf-dot").classed("label--active", active);
    node.select("text").classed("label--active", active);
    setHoverPath(leafDatum, active);
    if (active) showLeafTooltip(leafDatum);
    else tooltip.style("display", "none");
  }

  function showLeafTooltip(leafDatum) {
    const title = leafDatum.name || "";
    const themePath = leafDatum.theme_path?.join(" / ") || "主题组合待分析";
    tooltip.raise().style("display", null);
    tooltip.select(".tooltip-title").text(shortLabel(title, 18));
    tooltip.select(".tooltip-theme").text(shortLabel(themePath, 32));
    const titleWidth = tooltip.select(".tooltip-title").node().getBBox().width;
    const themeWidth = tooltip.select(".tooltip-theme").node().getBBox().width;
    const panelWidth = Math.min(292, Math.max(118, Math.max(titleWidth, themeWidth) + 24));
    const panelHeight = 54;
    const x = width - panelWidth;
    const y = 40;
    tooltip.attr("transform", `translate(${x},${y})`);
    tooltip.select("rect").attr("width", panelWidth).attr("height", panelHeight);
  }

  drawPinnedLeafLabels(base, layout, selected, activePlayId, (layout.leaves || []).filter((d) => selected.has(d.play_id) || d.play_id === activePlayId));
}

function drawPinnedLeafLabels(container, layout, selected, activePlayId, items) {
  if (!items.length) return;
  container.append("g").attr("class", "theme-pinned-labels")
    .selectAll("text")
    .data(items)
    .join("text")
    .attr("dy", ".31em")
    .attr("x", (d) => pinnedLabelPosition(d, layout.inner_radius).x)
    .attr("transform", (d) => pinnedLabelPosition(d, layout.inner_radius).transform)
    .attr("text-anchor", (d) => pinnedLabelPosition(d, layout.inner_radius).anchor)
    .attr("class", (d) => ["theme-pinned-leaf-label", selected.has(d.play_id) ? "selected" : "", d.play_id === activePlayId ? "active" : ""].join(" "))
    .text((d) => d.name);
}

function pinnedLabelPosition(d, radius) {
  const inner = radius - 16;
  return {
    x: d.angle < 180 ? -6 : 6,
    anchor: d.angle < 180 ? "end" : "start",
    transform: `rotate(${d.angle - 90}) translate(${inner},0)${d.angle < 180 ? "" : " rotate(180)"}`
  };
}

function branchIdsFromThemePath(themePath) {
  const ids = [];
  for (let index = 0; index < themePath.length; index += 1) {
    ids.push(`root:主题:${themePath.slice(0, index + 1).join(":")}`);
  }
  return ids;
}

function fallbackLeafCellPath(leaves, index, center, radius) {
  const current = leaves[index];
  const prev = leaves[index - 1] || { angle: leaves[leaves.length - 1].angle - 360 };
  const next = leaves[index + 1] || { angle: leaves[0].angle + 360 };
  const start = (prev.angle + current.angle) / 2;
  const end = (current.angle + next.angle) / 2;
  const inner = radius - 12;
  const outer = radius + 88;
  const p0 = polarPoint(center, start, inner);
  const p1 = polarPoint(center, end, inner);
  const p2 = polarPoint(center, end, outer);
  const p3 = polarPoint(center, start, outer);
  const largeArc = Math.abs(end - start) > 180 ? 1 : 0;
  return `M${p0.x},${p0.y}A${inner},${inner} 0 ${largeArc} 1 ${p1.x},${p1.y}L${p2.x},${p2.y}A${outer},${outer} 0 ${largeArc} 0 ${p3.x},${p3.y}Z`;
}

function polarPoint(center, angle, radius) {
  const radians = ((angle - 90) / 180) * Math.PI;
  return {
    x: center[0] + Math.cos(radians) * radius,
    y: center[1] + Math.sin(radians) * radius
  };
}

function buildThemeHierarchy(plays, selectedPlayIds, activePlayId) {
  const root = { name: "主题", length: 0, branchset: [], childByName: new Map(), totalCount: plays.length, order: 0 };
  const pathCounts = buildThemePathCounts(plays);
  const sorted = [...plays].sort((a, b) => {
    const selectedDelta = Number(selectedPlayIds.has(b.play_id) || b.play_id === activePlayId) - Number(selectedPlayIds.has(a.play_id) || a.play_id === activePlayId);
    const confidenceDelta = (b.visualLabel?.label_confidence || 0) - (a.visualLabel?.label_confidence || 0);
    return selectedDelta || confidenceDelta || d3.ascending(a.title, b.title);
  });

  for (const play of sorted) {
    const themePath = getPlayThemePath(play);

    let parent = root;
    themePath.forEach((theme, index) => {
      if (!parent.childByName.has(theme)) {
        const prefix = themePath.slice(0, index + 1).join(" | ");
        const child = {
          name: theme,
          length: 0.85 + index * 0.42,
          branchset: [],
          childByName: new Map(),
          count: 0,
          totalCount: pathCounts.get(prefix) || 0,
          order: parent.branchset.length,
          selected: false,
          active: false
        };
        parent.childByName.set(theme, child);
        parent.branchset.push(child);
      }
      parent = parent.childByName.get(theme);
      parent.count += 1;
      parent.selected ||= selectedPlayIds.has(play.play_id);
      parent.active ||= play.play_id === activePlayId;
    });

    parent.branchset.push({
      name: play.title,
      length: 0.45 + Math.min((play.visualLabel?.label_confidence || 0.5) * 0.85, 0.9),
      playId: play.play_id,
      themePath,
      order: parent.branchset.length,
      selected: selectedPlayIds.has(play.play_id),
      active: play.play_id === activePlayId
    });
  }

  stripChildMaps(root);
  return root;
}

function buildThemePathCounts(plays) {
  const counts = new Map();
  for (const play of plays) {
    const path = getPlayThemePath(play);
    for (let index = 0; index < path.length; index += 1) {
      const prefix = path.slice(0, index + 1).join(" | ");
      counts.set(prefix, (counts.get(prefix) || 0) + 1);
    }
  }
  return counts;
}

function stripChildMaps(node) {
  delete node.childByName;
  if (node.branchset?.length) {
    node.branchset.sort((a, b) => {
      const selectedDelta = Number(Boolean(b.selected || b.active)) - Number(Boolean(a.selected || a.active));
      return selectedDelta || (b.totalCount || b.count || 0) - (a.totalCount || a.count || 0) || d3.ascending(a.name, b.name);
    });
    node.branchset.forEach(stripChildMaps);
  }
}

function getPlayThemePath(play) {
  const themes = (play.topic?.themes || [])
    .filter((theme) => theme.theme && (theme.weight || 0) > 0)
    .sort((a, b) => d3.descending(a.weight || 0, b.weight || 0));
  const strongThemes = themes.filter((theme, index) => index === 0 || (theme.weight || 0) >= 0.055).slice(0, 3);
  const path = strongThemes.map((theme) => theme.theme);
  if (!path.length && play.theme) path.push(play.theme);
  return [...new Set(path)].slice(0, 3);
}

function drawRoleOverview(svg, play, model, selectedPlayIds) {
  const groups = buildOverviewGroups(model.plays, (item) => item.relation, play?.relation, selectedPlayIds, 7);
  drawOverviewForceGraph(svg, groups, play?.play_id, selectedPlayIds, { paletteOffset: 2, playLimit: 6 });
}

function drawNarrativeOverview(svg, play, model, selectedPlayIds) {
  const groups = buildOverviewGroups(model.plays, (item) => item.narrative, play?.narrative, selectedPlayIds, 7);
  drawOverviewForceGraph(svg, groups, play?.play_id, selectedPlayIds, { paletteOffset: 5, playLimit: 6 });
}

function buildOverviewGroups(plays, keyAccessor, activeKey, selectedPlayIds, maxGroups) {
  const selected = new Set(selectedPlayIds);
  return d3
    .groups(
      plays.filter((item) => keyAccessor(item)),
      keyAccessor
    )
    .sort((a, b) => groupPriority(b) - groupPriority(a) || d3.descending(a[1].length, b[1].length))
    .slice(0, maxGroups);

  function groupPriority([key, groupPlays]) {
    return (key === activeKey ? 4 : 0) + (groupPlays.some((item) => selected.has(item.play_id)) ? 8 : 0);
  }
}

function drawOverviewForceGraph(svg, groups, activePlayId, selectedPlayIds, options = {}) {
  const width = 760;
  const height = 680;
  const margin = 30;
  const selected = new Set(selectedPlayIds);
  const palette = d3.schemeTableau10;
  const nodes = [];
  const links = [];
  const groupCount = Math.max(1, groups.length);
  const centerRadius = groupCount === 1 ? 0 : 180;

  groups.forEach(([groupName, groupPlays], groupIndex) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * groupIndex) / groupCount;
    const centerX = width / 2 + Math.cos(angle) * centerRadius;
    const centerY = height / 2 + Math.sin(angle) * centerRadius * 0.76;
    const groupId = `group:${groupIndex}`;
    const color = palette[(groupIndex + (options.paletteOffset || 0)) % palette.length];
    const pickedPlays = pickGroupPlays(groupPlays, selected, options.playLimit || 6);
    const groupSelected = groupPlays.some((item) => selected.has(item.play_id));
    const groupActive = groupPlays.some((item) => item.play_id === activePlayId);

    nodes.push({
      id: groupId,
      name: groupName,
      kind: "group",
      color,
      radius: Math.min(25, 12 + Math.sqrt(groupPlays.length) * 0.58),
      centerX,
      centerY,
      selected: groupSelected,
      active: groupActive
    });

    pickedPlays.forEach((item) => {
      const isSelected = selected.has(item.play_id);
      const isActive = item.play_id === activePlayId;
      nodes.push({
        id: item.play_id,
        name: item.title,
        kind: "play",
        playId: item.play_id,
        sourceGroupId: groupId,
        color,
        radius: isActive ? 9.2 : isSelected ? 8 : 5.8,
        centerX,
        centerY,
        selected: isSelected,
        active: isActive
      });
      links.push({
        source: groupId,
        target: item.play_id,
        color,
        selected: isSelected,
        active: isActive
      });
    });
  });

  if (!nodes.length) return;

  const viewport = svg.append("g");
  svg.call(
    d3
      .zoom()
      .scaleExtent([0.65, 3.2])
      .on("zoom", (event) => viewport.attr("transform", event.transform))
  );

  const link = viewport
    .append("g")
    .attr("class", "context-force-links")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("class", (d) => ["context-force-link", d.selected ? "selected" : "", d.active ? "active" : ""].join(" "))
    .attr("stroke", (d) => d.color);

  const node = viewport
    .append("g")
    .attr("class", "context-force-nodes")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", (d) =>
      ["context-force-node", d.kind, d.selected ? "selected" : "", d.active ? "active" : ""].join(" ")
    )
    .on("click", (event, d) => {
      event.stopPropagation();
      if (d.playId) window.toggleLayer4Play(d.playId);
    })
    .on("mouseover", (_, d) => setOverviewFocus(d, true))
    .on("mouseout", (_, d) => setOverviewFocus(d, false))
    .call(dragOverviewNode());

  node
    .append("circle")
    .attr("r", (d) => d.radius)
    .attr("fill", (d) => d.color);

  node
    .append("text")
    .attr("x", (d) => d.radius + 4)
    .attr("y", 4)
    .attr("class", (d) => ["context-force-label", d.kind, d.selected ? "selected" : "", d.active ? "active" : ""].join(" "))
    .text((d) => shortLabel(d.name, d.kind === "group" ? 8 : 5));

  const simulation = d3
    .forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((d) => d.id).distance(42).strength(0.76))
    .force("charge", d3.forceManyBody().strength((d) => (d.kind === "group" ? -240 : -58)))
    .force("x", d3.forceX((d) => d.centerX).strength((d) => (d.kind === "group" ? 0.2 : 0.08)))
    .force("y", d3.forceY((d) => d.centerY).strength((d) => (d.kind === "group" ? 0.2 : 0.08)))
    .force("collide", d3.forceCollide().radius((d) => d.radius + 11))
    .on("tick", ticked);

  function ticked() {
    for (const d of nodes) {
      d.x = Math.max(margin, Math.min(width - margin, d.x));
      d.y = Math.max(margin, Math.min(height - margin, d.y));
    }

    link
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);

    node.attr("transform", (d) => `translate(${d.x},${d.y})`);
  }

  function setOverviewFocus(target, active) {
    link.classed("link--active", (item) => active && isConnected(target, item));
    node.classed("node--active", (item) => active && (item.id === target.id || isLinkedNode(target, item)));
  }

  function dragOverviewNode() {
    return d3
      .drag()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.25).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = Math.max(margin, Math.min(width - margin, event.x));
        d.fy = Math.max(margin, Math.min(height - margin, event.y));
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
  }
}

function pickGroupPlays(plays, selected, limit) {
  const selectedPlays = plays.filter((item) => selected.has(item.play_id));
  const rest = plays
    .filter((item) => !selected.has(item.play_id))
    .sort((a, b) => d3.descending(a.page_count || 0, b.page_count || 0));
  return [...selectedPlays, ...rest.slice(0, Math.max(0, limit - selectedPlays.length))];
}

function isConnected(target, link) {
  const sourceId = typeof link.source === "object" ? link.source.id : link.source;
  const targetId = typeof link.target === "object" ? link.target.id : link.target;
  return sourceId === target.id || targetId === target.id;
}

function isLinkedNode(target, node) {
  if (target.kind === "group") return node.sourceGroupId === target.id;
  if (target.kind === "play") return node.id === target.sourceGroupId;
  return false;
}

function shortLabel(label, limit) {
  if (!label) return "";
  return label.length > limit ? `${label.slice(0, limit)}...` : label;
}

const THEME_SEGMENT_COLORS = ["#6fa8dc", "#f0a34b", "#e8706d", "#63b6b2", "#72c384", "#e7bd58", "#c89bd0", "#e89aa4", "#bd8a72", "#b6afa3"];

function buildThemeColorLookupFromHierarchy(root) {
  const lookup = new Map();
  for (const node of root.descendants()) {
    if (node.children && node.depth > 0 && node.data?.name && !lookup.has(node.data.name)) {
      lookup.set(node.data.name, node.depth === 1 ? node.color : themeNameColor(node.data.name));
    }
  }
  return lookup;
}

function buildThemeColorLookupFromLayout(layout) {
  const lookup = new Map();
  for (const item of layout.legend || []) {
    if (item.name && item.color) lookup.set(item.name, item.color);
  }
  for (const branch of layout.branches || []) {
    if (branch.name && !lookup.has(branch.name)) lookup.set(branch.name, themeNameColor(branch.name));
  }
  for (const leaf of layout.leaves || []) {
    for (const theme of leaf.theme_path || []) {
      if (theme && !lookup.has(theme)) lookup.set(theme, themeNameColor(theme));
    }
  }
  return lookup;
}

function themeNameColor(name) {
  let hash = 0;
  for (const char of name || "") hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return THEME_SEGMENT_COLORS[hash % THEME_SEGMENT_COLORS.length];
}

function themeLinkColor(link, lookup) {
  const target = link.target;
  if (target?.children && target.data?.name) return lookup.get(target.data.name) || target.color || themeNameColor(target.data.name);
  const sourceName = link.source?.data?.name;
  return lookup.get(sourceName) || target?.color || themeNameColor(sourceName);
}

function precomputedLinkColor(link, lookup) {
  const targetTheme = precomputedThemeNameFromId(link.target);
  if (targetTheme) return lookup.get(targetTheme) || themeNameColor(targetTheme);
  const sourceTheme = precomputedThemeNameFromId(link.source);
  return lookup.get(sourceTheme) || link.color || themeNameColor(sourceTheme);
}

function precomputedThemeNameFromId(id) {
  if (!id || !String(id).startsWith("root:主题:")) return null;
  const parts = String(id).split(":");
  return parts[parts.length - 1] || null;
}

function maxLength(d) {
  return d.data.length + (d.children ? d3.max(d.children, maxLength) : 0);
}

function setRadius(d, y0, k) {
  d.radius = (y0 += d.data.length) * k;
  if (d.children) d.children.forEach((child) => setRadius(child, y0, k));
}

function setColor(d) {
  const themeColors = d3.schemeTableau10;
  if (d.depth === 1) d.color = themeColors[d.parent.children.indexOf(d) % themeColors.length];
  else d.color = d.parent ? d.parent.color : "#8f1f28";
  if (d.children) d.children.forEach(setColor);
}

function linkConstant(d) {
  return linkStep(d.source.x, d.source.radius, d.target.x, d.target.radius);
}

function linkExtensionConstant(innerRadius) {
  return function (d) {
    return linkStep(d.target.x, d.target.radius, d.target.x, innerRadius);
  };
}

function linkStep(startAngle, startRadius, endAngle, endRadius) {
  const c0 = Math.cos(((startAngle - 90) / 180) * Math.PI);
  const s0 = Math.sin(((startAngle - 90) / 180) * Math.PI);
  const c1 = Math.cos(((endAngle - 90) / 180) * Math.PI);
  const s1 = Math.sin(((endAngle - 90) / 180) * Math.PI);
  return `M${startRadius * c0},${startRadius * s0}${
    endAngle === startAngle
      ? ""
      : `A${startRadius},${startRadius} 0 0 ${endAngle > startAngle ? 1 : 0} ${startRadius * c1},${startRadius * s1}`
  }L${endRadius * c1},${endRadius * s1}`;
}

function drawReservedOverview(svg, title, subtitle) {
  svg
    .append("rect")
    .attr("x", 44)
    .attr("y", 56)
    .attr("width", 432)
    .attr("height", 232)
    .attr("rx", 18)
    .attr("class", "reserved-box");
  svg.append("text").attr("x", 260).attr("y", 158).attr("text-anchor", "middle").attr("class", "svg-label").text(title);
  svg.append("text").attr("x", 260).attr("y", 188).attr("text-anchor", "middle").attr("class", "svg-small").text(subtitle);
}

function drawRoleNetwork(plays, helpers, zoomedPlayId) {
  const svg = d3.select("#role-network");
  const width = 860;
  const height = 500;
  const selected = plays.slice(0, 4).filter((item) => item?.network?.nodes?.length);
  if (!selected.length) return;

  // Hangdang legend — draw once, keep stable across transitions
  if (svg.selectAll("g.hangdang-legend").empty()) {
    drawHangdangLegend(svg, width);
  }

  // Clear DOM on mode switch (grid↔zoom)
  // When navigating in zoom mode, keep the overlay (tabs) for continuity
  // If the play selection count changed, fully recreate overlay to keep tabs in sync
  const wasZoomed = !svg.selectAll("g.role-network-overlay").empty();
  const isZooming = !!zoomedPlayId;
  const prevCount = Number(svg.attr("data-zoom-count") || 0);
  const countChanged = prevCount !== selected.length;
  if (wasZoomed !== isZooming || (isZooming && countChanged)) {
    if (wasZoomed && !isZooming) {
      // Exiting zoom: remove panel instantly, fade out overlay smoothly
      svg.selectAll("g.role-panel").remove();
      svg.select("g.role-network-overlay")
        .transition().duration(500).style("opacity", 0).remove();
      svg.select("g.hangdang-legend").style("display", null);
    } else {
      svg.selectAll("g.role-panel, g.role-network-overlay").remove();
      if (!isZooming) svg.select("g.hangdang-legend").style("display", null);
    }
  } else if (isZooming && wasZoomed) {
    svg.selectAll("g.role-panel").remove();
  }
  svg.attr("data-zoom-count", selected.length);

  if (isZooming) {
    svg.select("g.hangdang-legend").style("display", "none");
    // If zoomed play was deselected, fall back to first available play
    const actualPlayId = selected.find((p) => p.play_id === zoomedPlayId)?.play_id || selected[0]?.play_id;
    const play = selected.find((p) => p.play_id === actualPlayId);
    if (play) {
      const newPanel = drawZoomedRoleNetworkPanel(svg, play, width, height, selected, helpers, wasZoomed || countChanged);
      // Smooth fade-in for the new panel only
      if (newPanel) {
        newPanel.style("opacity", 0)
          .transition().duration(500).ease(d3.easeCubicOut)
          .style("opacity", 1);
      }
    }
    return;
  }

  const layout = roleNetworkPanels(selected.length, width, height);

  // Data join on panel groups, keyed by play_id for stable identity
  const panelData = selected.map((play, index) => ({
    id: play.play_id,
    play,
    layout: layout[index],
    panelIndex: index
  }));

  let panels = svg.selectAll("g.role-panel")
    .data(panelData, d => d.id);

  // EXIT: panels being removed — fade out smoothly
  panels.exit()
    .transition().duration(250)
    .style("opacity", 0)
    .remove();

  // ENTER: new panels — set position immediately, fade in at final position
  let enterPanels = panels.enter()
    .append("g")
    .attr("class", "role-panel")
    .style("opacity", 0)
    .attr("transform", d => `translate(${d.layout.x},${d.layout.y})`);

  enterPanels
    .transition().duration(350).delay(60)
    .style("opacity", 1);

  // UPDATE: existing panels smoothly transition to new grid positions
  panels
    .transition().duration(400).ease(d3.easeCubicOut)
    .attr("transform", d => `translate(${d.layout.x},${d.layout.y})`);

  // Draw content for all panels
  let allPanels = enterPanels.merge(panels);
  allPanels.each(function (d) {
    drawRoleNetworkPanel(d3.select(this), d.play, d.layout, helpers, d.panelIndex);
  });

  // Click panel title to enter zoom mode
  allPanels.each(function (d) {
    const panel = d3.select(this);
    const titleText = panel.select(".role-panel-title");
    const titleCx = 10, titleCy = 18;
    // Hover area — click enters zoom mode
    panel.insert("rect", ".role-panel-title")
      .attr("x", 0).attr("y", 0)
      .attr("width", d.layout.width).attr("height", 24)
      .attr("fill", "transparent")
      .attr("class", "panel-title-hitarea");
    // Hover and click on title text only
    titleText.style("cursor", "pointer")
      .on("click", (event) => {
        event.stopPropagation();
        window.zoomRoleNetwork(d.id);
      })
      .on("mouseenter", function () {
        d3.select(this).style("fill", "rgba(255,255,255,0.9)")
          .transition().duration(200)
          .attr("transform", `translate(${titleCx},${titleCy}) scale(1.1) translate(${-titleCx},${-titleCy})`);
      })
      .on("mouseleave", function () {
        d3.select(this).style("fill", null)
          .transition().duration(200)
          .attr("transform", null);
      });
  });
}

function drawZoomedRoleNetworkPanel(svg, play, width, height, allPlays, helpers, navigating) {
  const currentIndex = allPlays.findIndex((p) => p.play_id === play.play_id);
  const tabW = 64;
  const tabH = 34;
  const tabGap = 2;
  const tabX = 4; // tabs at top-left

  const overlay = svg.select("g.role-network-overlay");
  const hasOverlay = !overlay.empty();

  if (!hasOverlay) {
    const newOverlay = svg.append("g").attr("class", "role-network-overlay");

    // Tabs at right-middle, vertically centered
    const n = allPlays.length;
    const totalTabsH = n * tabH + (n - 1) * tabGap;
    const tabsY = 54;

    allPlays.forEach((p, i) => {
      const ty = tabsY + i * (tabH + tabGap);
      const isActive = i === currentIndex;
      const tab = newOverlay.append("g").attr("class", "zoom-tab")
        .style("cursor", "pointer")
        .on("click", isActive
          ? () => window.unzoomRoleNetwork()
          : () => window.zoomRoleNetwork(p.play_id));
      tab.append("rect")
        .attr("x", tabX + (isActive ? -4 : 0)).attr("y", ty)
        .attr("width", tabW + (isActive ? 4 : 0)).attr("height", tabH)
        .attr("fill", isActive ? "rgba(247,236,215,0.13)" : "rgba(247,236,215,0.03)")
        .attr("stroke", isActive ? "rgba(247,236,215,0.22)" : "rgba(247,236,215,0.06)")
        .attr("stroke-width", 0.5);
      if (isActive) {
        tab.append("rect").attr("class", "tab-accent-bar")
          .attr("x", tabX - 4).attr("y", ty + 3)
          .attr("width", 3).attr("height", tabH - 6).attr("rx", 1.5)
          .attr("fill", "#e8a87c");
      }
      const dn = p.title.length <= 4 ? p.title : shortLabel(p.title, 5);
      tab.append("text")
        .attr("x", tabX + tabW / 2 + (isActive ? 2 : 0)).attr("y", ty + tabH / 2 + 4)
        .attr("text-anchor", "middle")
        .attr("fill", isActive ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)")
        .style("font-size", isActive ? "11px" : "10px")
        .style("font-weight", isActive ? "600" : "400")
        .text(dn);
      // Hover: scale up on any inactive tab
      tab.on("mouseenter", function () {
        const t = d3.select(this);
        t.select("rect").attr("fill", "rgba(247,236,215,0.08)");
        t.select("text").attr("fill", "rgba(255,255,255,0.7)");
        if (!isActive) {
          t.transition().duration(150)
            .attr("transform", `translate(${tabX + tabW / 2},${ty + tabH / 2}) scale(1.1) translate(${-tabX - tabW / 2},${-ty - tabH / 2})`);
        }
      });
      tab.on("mouseleave", function () {
        const t = d3.select(this);
        t.select("rect").attr("fill", isActive ? "rgba(247,236,215,0.13)" : "rgba(247,236,215,0.03)");
        t.select("text").attr("fill", isActive ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)");
        t.transition().duration(150).attr("transform", null);
      });
    });
  } else {
    // --- Navigating: update tabs ---
    const n = allPlays.length;
    const totalTabsH = n * tabH + (n - 1) * tabGap;
    const tabsY = 54;

    overlay.selectAll("g.zoom-tab").each(function (_, i) {
      const tab = d3.select(this);
      const isActive = i === currentIndex;
      const ty = tabsY + i * (tabH + tabGap);
      tab.select("rect")
        .attr("x", tabX + (isActive ? -4 : 0)).attr("y", ty)
        .attr("width", tabW + (isActive ? 4 : 0)).attr("height", tabH)
        .attr("fill", isActive ? "rgba(247,236,215,0.13)" : "rgba(247,236,215,0.03)")
        .attr("stroke", isActive ? "rgba(247,236,215,0.22)" : "rgba(247,236,215,0.06)");
      tab.select("text")
        .attr("x", tabX + tabW / 2 + (isActive ? 2 : 0)).attr("y", ty + tabH / 2 + 4)
        .attr("fill", isActive ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)")
        .style("font-size", isActive ? "11px" : "10px")
        .style("font-weight", isActive ? "600" : "400")
        .text(allPlays[i].title.length <= 4 ? allPlays[i].title : shortLabel(allPlays[i].title, 5));
      tab.selectAll(".tab-accent-bar").remove();
      if (isActive) {
        tab.append("rect").attr("class", "tab-accent-bar")
          .attr("x", tabX - 4).attr("y", ty + 3)
          .attr("width", 3).attr("height", tabH - 6).attr("rx", 1.5)
          .attr("fill", "#e8a87c");
      }
      tab.on("click", null);
      tab.style("cursor", "pointer")
        .on("click", isActive
          ? () => window.unzoomRoleNetwork()
          : () => window.zoomRoleNetwork(allPlays[i].play_id));
    });
  }

  // --- Draw the network panel — same size as grid mode (1-panel) ---
  const panelLayout = { x: 0, y: 22, width, height: height - 22 };

  const panelGroup = svg.append("g").attr("class", "role-panel")
    .attr("transform", `translate(0,22)`);
  drawRoleNetworkPanel(panelGroup, play, panelLayout, helpers, 0);
  panelGroup.select("svg.role-panel-svg").style("overflow", "hidden");
  // Raise title above the nested SVG so it's not blocked by SVG viewport
  panelGroup.select(".role-panel-title").raise();

  // Add hangdang legend — same style and position as grid overview legend
  const hgItems = ["生", "旦", "净", "丑", "其他"];
  const hgColors = { 生: "#6fa8dc", 旦: "#e8706d", 净: "#72c384", 丑: "#f0a34b", 其他: "#c89bd0" };
  const hgLegend = panelGroup.append("g").attr("class", "hangdang-legend")
    .attr("transform", `translate(440,${14 - 22})`);
  const hgItem = hgLegend.selectAll("g").data(hgItems).join("g")
    .attr("transform", (_, index) => `translate(${index * 38},0)`);
  hgItem.append("circle").attr("r", 4).attr("fill", (d) => hgColors[d]);
  hgItem.append("text").attr("x", 7).attr("y", 4).text((d) => d);

  svg.select(".role-network-overlay").raise();
  return panelGroup;
}

function roleNetworkPanels(count, width, height) {
  const gap = 6;
  const side = 0;
  const top = 22;
  const bottom = 0;
  if (count === 1) {
    return [{ x: side, y: top, width: width - side * 2, height: height - top - bottom }];
  }
  if (count === 2) {
    const panelWidth = (width - gap - side * 2) / 2;
    return [0, 1].map((index) => ({
      x: side + index * (panelWidth + gap),
      y: top,
      width: panelWidth,
      height: height - top - bottom
    }));
  }
  const panelWidth = (width - gap - side * 2) / 2;
  const panelHeight = (height - gap - top - bottom) / 2;
  return [0, 1, 2, 3].slice(0, count).map((index) => ({
    x: side + (index % 2) * (panelWidth + gap),
    y: top + Math.floor(index / 2) * (panelHeight + gap),
    width: panelWidth,
    height: panelHeight
  }));
}

function drawRoleNetworkPanel(panelGroup, play, panelLayout, helpers, panelIndex) {
  // Clear previous content within the panel (panel shell is owned by the data join)
  panelGroup.selectAll("*").remove();

  const margin = { top: 22, right: 2, bottom: 2, left: 2 };
  const innerWidth = Math.max(120, panelLayout.width - margin.left - margin.right);
  const innerHeight = Math.max(100, panelLayout.height - margin.top - margin.bottom);
  const metrics = play.network?.network_metrics || {};
  const sourceNodes = play.network?.nodes || [];
  const allowed = new Set(sourceNodes.map((item) => item.name));
  const nodes = sourceNodes.map((item) => ({
    id: item.name,
    name: item.name,
    hangdang: normalizeHangdang(item.hangdang),
    importance: roleImportance(item),
    speechCount: item.speech_count || 0,
    degree: 0
  }));
  const links = (play.network?.edges || [])
    .filter((edge) => allowed.has(edge.source) && allowed.has(edge.target))
    .map((edge) => ({
      source: edge.source,
      target: edge.target,
      weight: Number(edge.weight || 1),
      label: edge.relation_label || "同场共现"
    }));

  const degreeByName = new Map();
  for (const edge of links) {
    degreeByName.set(edge.source, (degreeByName.get(edge.source) || 0) + 1);
    degreeByName.set(edge.target, (degreeByName.get(edge.target) || 0) + 1);
  }
  for (const node of nodes) node.degree = degreeByName.get(node.id) || 0;
  const componentLayout = buildRoleComponentLayout(nodes, links, innerWidth, innerHeight);

  panelGroup.append("rect").attr("class", "role-panel-bg")
    .attr("width", panelLayout.width).attr("height", panelLayout.height).attr("rx", 7);

  const title = `${play.title} · ${metrics.structure_type || "关系结构待分析"} · 密度 ${formatDensity(metrics.density)}`;
  panelGroup.append("text").attr("class", "role-panel-title")
    .attr("x", 10).attr("y", 18)
    .text(shortLabel(title, panelLayout.width < 260 ? 18 : 30));

  panelGroup.append("text").attr("class", "role-panel-count")
    .attr("x", panelLayout.width - 10).attr("y", panelLayout.height - 8).attr("text-anchor", "end")
    .text(`${nodes.length} 角 / ${links.length} 线`);

  const panelSvg = panelGroup.append("svg").attr("class", "role-panel-svg")
    .attr("x", margin.left).attr("y", margin.top)
    .attr("width", innerWidth).attr("height", innerHeight)
    .attr("viewBox", `0 0 ${innerWidth} ${innerHeight}`)
    .attr("preserveAspectRatio", "xMidYMid meet");
  panelSvg.append("rect").attr("class", "role-zoom-surface").attr("width", innerWidth).attr("height", innerHeight);
  // overflow:hidden on .role-panel-svg clips nodes at viewport boundary (soft boundary)
  const zoomLayer = panelSvg.append("g").attr("class", "role-zoom-layer");
  // Visible boundary frame — outside panelSvg to isolate from inner SVG repaints
  panelGroup.append("rect")
    .attr("x", margin.left).attr("y", margin.top)
    .attr("width", innerWidth).attr("height", innerHeight)
    .attr("rx", 6).attr("ry", 6)
    .attr("fill", "none")
    .attr("stroke", "rgba(248,231,194,0.96)")
    .attr("stroke-width", 1);
  if (!nodes.length) return;

  const maxWeight = d3.max(links, (d) => d.weight) || 1;
  const link = zoomLayer.append("g").attr("class", "network-links")
    .selectAll("line").data(links).join("line")
    .attr("stroke-width", (d) => Math.max(0.45, Math.sqrt(d.weight / maxWeight) * 3.2));

  const node = zoomLayer.append("g").attr("class", "network-nodes")
    .selectAll("g").data(nodes).join("g").call(dragRoleNode());

  node.append("circle")
    .attr("r", (d) => 3.4 + d.importance * 8.5)
    .attr("fill", (d) => hangdangColor(d.hangdang));

  const labelled = new Set(
    [...nodes]
      .sort((a, b) => d3.descending(a.importance, b.importance) || d3.descending(a.degree, b.degree) || d3.descending(a.speechCount, b.speechCount))
      .slice(0, roleLabelLimit(nodes.length))
      .map((d) => d.id)
  );

  node.filter((d) => labelled.has(d.id))
    .append("text")
    .attr("x", (d) => 5 + d.importance * 8).attr("y", 3)
    .attr("class", "network-label")
    .text((d) => shortLabel(d.name, 4));

  const info = panelSvg.append("g").attr("class", "role-node-info").style("display", "none");
  info.append("rect").attr("rx", 5).attr("ry", 5);
  info.append("text").attr("class", "role-node-info-title").attr("x", 8).attr("y", 8);
  info.append("text").attr("class", "role-node-info-meta").attr("x", 8).attr("y", 27);

  node
    .on("mouseenter", (_, d) => {
      const name = shortLabel(d.name, 12);
      const meta = `${d.hangdang} · ${d.speechCount || 0}句 · 重要性${d.importance.toFixed(2)} · 度${d.degree}`;
      info.raise().style("display", null);
      info.select(".role-node-info-title").text(name);
      info.select(".role-node-info-meta").text(meta);
      const titleWidth = info.select(".role-node-info-title").node().getBBox().width;
      const metaWidth = info.select(".role-node-info-meta").node().getBBox().width;
      const boxWidth = Math.min(innerWidth - 12, Math.max(126, titleWidth, metaWidth) + 16);
      info.attr("transform", `translate(${innerWidth - boxWidth - 6}, 6)`);
      info.select("rect").attr("width", boxWidth).attr("height", 44);
      // Highlight connected edges and neighbor nodes
      link.classed("link--active", (l) => (l.source.id || l.source) === d.id || (l.target.id || l.target) === d.id);
      node.classed("node--active", (n) => n.id === d.id || isNeighbor(d, n));
    })
    .on("mouseleave", () => {
      info.style("display", "none");
      link.classed("link--active", false);
      node.classed("node--active", false);
    });

  const minPanelSide = Math.min(innerWidth, innerHeight);
  const spreadDistance = nodes.length <= 4 ? minPanelSide * 0.5 : nodes.length <= 12 ? minPanelSide * 0.34 : minPanelSide * 0.22;
  const chargeStrength = nodes.length <= 4 ? -minPanelSide * 1.05 : -Math.max(92, minPanelSide * 0.68);
  const simulation = d3
    .forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((d) => d.id).distance((d) => Math.max(34, spreadDistance / Math.sqrt(Math.max(1, d.weight)))).strength(0.42))
    .force("charge", d3.forceManyBody().strength(chargeStrength))
    .force("x", d3.forceX((d) => componentLayout.centers.get(d.id)?.x ?? innerWidth / 2).strength((d) => (d.degree ? 0.062 : 0.16)))
    .force("y", d3.forceY((d) => componentLayout.centers.get(d.id)?.y ?? innerHeight / 2).strength((d) => (d.degree ? 0.062 : 0.16)))
    .force("collide", d3.forceCollide().radius((d) => 5 + d.importance * 9))
    .force("boundary", () => {
      for (const d of nodes) {
        const r = 5 + d.importance * 9;
        d.x = Math.max(r, Math.min(innerWidth - r, d.x));
        d.y = Math.max(r, Math.min(innerHeight - r, d.y));
      }
    })
    .on("tick", ticked)
    .stop();

  for (let tick = 0; tick < 120; tick += 1) simulation.tick();
  fitRoleNetworkToComponents(componentLayout, innerWidth, innerHeight);
  for (let tick = 0; tick < 60; tick += 1) simulation.tick();
  ticked();

  const zoomBehavior = d3
    .zoom()
    .filter((event) => event.type === "wheel" || !event.target.closest?.(".network-nodes"))
    .scaleExtent([1, 5])
    .on("zoom", (event) => {
      const constrained = constrainRoleZoom(event.transform, innerWidth, innerHeight);
      zoomLayer.attr("transform", constrained);
      panelSvg.property("__zoom", constrained);
    });

  panelSvg.call(zoomBehavior).on("dblclick.zoom", null);

  function ticked() {
    link.attr("x1", (d) => d.source.x).attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x).attr("y2", (d) => d.target.y);
    node.attr("transform", (d) => `translate(${d.x},${d.y})`);
  }

  function dragRoleNode() {
    return d3.drag()
      .on("start", function (event, d) {
        d3.select(this).raise();
        if (!event.active) simulation.alphaTarget(0.12).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        const r = 5 + d.importance * 9;
        d.fx = Math.max(r, Math.min(innerWidth - r, event.x));
        d.fy = Math.max(r, Math.min(innerHeight - r, event.y));
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
  }

  function isNeighbor(a, b) {
    return links.some((l) => {
      const sa = typeof l.source === "object" ? l.source.id : l.source;
      const ta = typeof l.target === "object" ? l.target.id : l.target;
      return (sa === a.id && ta === b.id) || (ta === a.id && sa === b.id);
    });
  }
}

function roleLabelLimit(count) {
  if (count <= 6) return count;
  if (count <= 16) return 5;
  if (count <= 36) return 6;
  return 7;
}

function buildRoleComponentLayout(nodes, links, width, height) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const neighbors = new Map(nodes.map((node) => [node.id, []]));
  for (const link of links) {
    const source = typeof link.source === "object" ? link.source.id : link.source;
    const target = typeof link.target === "object" ? link.target.id : link.target;
    if (neighbors.has(source) && neighbors.has(target)) {
      neighbors.get(source).push(target);
      neighbors.get(target).push(source);
    }
  }

  const seen = new Set();
  const components = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    const stack = [node.id];
    const ids = [];
    seen.add(node.id);
    while (stack.length) {
      const id = stack.pop();
      ids.push(id);
      for (const next of neighbors.get(id) || []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    components.push({
      ids,
      nodes: ids.map((id) => nodeById.get(id)).filter(Boolean),
      size: ids.length,
      weight: d3.sum(ids, (id) => nodeById.get(id)?.importance || 0)
    });
  }

  components.sort((a, b) => d3.descending(a.size, b.size) || d3.descending(a.weight, b.weight));
  const centers = new Map();
  const boxes = new Map();
  const safe = { x0: 16, y0: 16, x1: width - 16, y1: height - 16 };
  if (components.length <= 1) {
    for (const node of nodes) centers.set(node.id, { x: width / 2, y: height / 2 });
    for (const node of nodes) boxes.set(node.id, safe);
    return { components, centers, boxes };
  }

  const centerX = width / 2;
  const centerY = height / 2;
  const orbitX = width * 0.3;
  const orbitY = height * 0.28;
  const main = components[0];
  const mainBox = {
    x0: width * 0.11,
    y0: height * 0.12,
    x1: width * 0.89,
    y1: height * 0.88
  };
  for (const id of main.ids) {
    centers.set(id, { x: centerX, y: centerY });
    boxes.set(id, mainBox);
  }

  const rest = components.slice(1);
  rest.forEach((component, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(1, rest.length)) * Math.PI * 2;
    const radiusScale = component.size === 1 ? 0.82 : 0.68;
    const x = centerX + Math.cos(angle) * orbitX * radiusScale;
    const y = centerY + Math.sin(angle) * orbitY * radiusScale;
    const boxRadiusX = Math.max(42, Math.min(width * 0.24, 22 + component.size * 11));
    const boxRadiusY = Math.max(34, Math.min(height * 0.24, 18 + component.size * 10));
    const box = {
      x0: Math.max(safe.x0, x - boxRadiusX),
      y0: Math.max(safe.y0, y - boxRadiusY),
      x1: Math.min(safe.x1, x + boxRadiusX),
      y1: Math.min(safe.y1, y + boxRadiusY)
    };
    for (const id of component.ids) {
      centers.set(id, { x, y });
      boxes.set(id, box);
    }
  });

  return { components, centers, boxes };
}

function fitRoleNetworkToComponents(layout, width, height) {
  for (const component of layout.components) {
    if (!component.nodes?.length) continue;
    const firstBox = layout.boxes.get(component.ids[0]) || { x0: 16, y0: 16, x1: width - 16, y1: height - 16 };
    fitNodesToBox(component.nodes, firstBox);
  }
}

function fitNodesToBox(nodes, box) {
  const padding = 8;
  const minX = d3.min(nodes, (d) => d.x) ?? box.x0;
  const maxX = d3.max(nodes, (d) => d.x) ?? box.x1;
  const minY = d3.min(nodes, (d) => d.y) ?? box.y0;
  const maxY = d3.max(nodes, (d) => d.y) ?? box.y1;
  const sourceWidth = Math.max(1, maxX - minX);
  const sourceHeight = Math.max(1, maxY - minY);
  const targetWidth = Math.max(1, box.x1 - box.x0 - padding * 2);
  const targetHeight = Math.max(1, box.y1 - box.y0 - padding * 2);
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const sourceCenterX = (minX + maxX) / 2;
  const sourceCenterY = (minY + maxY) / 2;
  const targetCenterX = (box.x0 + box.x1) / 2;
  const targetCenterY = (box.y0 + box.y1) / 2;

  for (const node of nodes) {
    node.x = targetCenterX + (node.x - sourceCenterX) * scale;
    node.y = targetCenterY + (node.y - sourceCenterY) * scale;
  }
}

function constrainRoleZoom(transform, width, height) {
  const k = transform.k;
  if (k <= 1) {
    // Let content reach either card edge: tx ∈ [0, width*(1-k)]
    // Left-aligned (tx=0): content starts at left edge
    // Right-aligned (tx=w*(1-k)): content ends at right edge
    const maxPanX = width * (1 - k);
    const maxPanY = height * (1 - k);
    const x = Math.max(0, Math.min(maxPanX, transform.x + maxPanX / 2));
    const y = Math.max(0, Math.min(maxPanY, transform.y + maxPanY / 2));
    return d3.zoomIdentity.translate(x, y).scale(k);
  }

  const minX = width * (1 - k);
  const minY = height * (1 - k);
  const x = Math.max(minX, Math.min(0, transform.x));
  const y = Math.max(minY, Math.min(0, transform.y));
  return d3.zoomIdentity.translate(x, y).scale(k);
}

function roleImportance(node) {
  const importance = Number(node.importance_score || 0);
  const speech = Number(node.speech_count || 0);
  return Math.max(0.12, Math.min(1, importance || Math.sqrt(speech) / 12));
}

function normalizeHangdang(hangdang) {
  if (!hangdang) return "其他";
  if (hangdang.includes("生")) return "生";
  if (hangdang.includes("旦")) return "旦";
  if (hangdang.includes("净")) return "净";
  if (hangdang.includes("丑")) return "丑";
  return "其他";
}

function hangdangColor(hangdang) {
  return {
    生: "#6fa8dc",
    旦: "#e8706d",
    净: "#72c384",
    丑: "#f0a34b",
    其他: "#c89bd0"
  }[hangdang] || "#c89bd0";
}

function drawHangdangLegend(svg, width) {
  const items = ["生", "旦", "净", "丑", "其他"];
  const legend = svg.append("g").attr("class", "hangdang-legend").attr("transform", `translate(440,14)`);
  const item = legend
    .selectAll("g")
    .data(items)
    .join("g")
    .attr("transform", (_, index) => `translate(${index * 38},0)`);
  item.append("circle").attr("r", 4).attr("fill", (d) => hangdangColor(d));
  item.append("text").attr("x", 7).attr("y", 4).text((d) => d);
}

function formatDensity(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "--";
}

function narrativeSeriesColor(index) {
  const colors = ["#d96f73", "#e7b957", "#5fb4b8", "#78a6dc"];
  return colors[index % colors.length];
}

function drawNarrativeTimeline(plays, helpers) {
  const svg = d3.select("#narrative-chart");
  svg.selectAll("*").remove();

  const series = plays
    .map((play, index) => {
      const rhythm = play?.topic?.narrative_structure?.rhythm_curve || [];
      const maxScene = d3.max(rhythm, (d) => Number(d.scene_no) || 0) || rhythm.length || 1;
      return {
        play,
        color: narrativeSeriesColor(index),
        maxScene,
        rhythm: rhythm.map((point, pointIndex) => ({
          ...point,
          scene_no: Number(point.scene_no) || pointIndex + 1,
          progress: maxScene <= 1 ? 0.5 : ((Number(point.scene_no) || pointIndex + 1) - 1) / (maxScene - 1)
        }))
      };
    })
    .filter((item) => item.rhythm.length);
  if (!series.length) return;

  const width = 1260;
  const height = 620;
  const margin = { top: 120, right: 48, bottom: 56, left: 56 };
  const x = d3.scaleLinear().domain([0, 1]).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, 1]).nice().range([height - margin.bottom, margin.top]);

  const line = d3
    .line()
    .defined((d) => Number.isFinite(d.progress) && Number.isFinite(Number(d.tension)))
    .x((d) => x(d.progress))
    .y((d) => y(Math.max(0, Math.min(1, d.tension || 0))))
    .curve(d3.curveMonotoneX);

  const area = d3
    .area()
    .defined((d) => Number.isFinite(d.progress) && Number.isFinite(Number(d.tension)))
    .x((d) => x(d.progress))
    .y0(height - margin.bottom)
    .y1((d) => y(Math.max(0, Math.min(1, d.tension || 0))))
    .curve(d3.curveMonotoneX);

  // Stage bands (起承转合)
  const stageBands = [
    ["起", 0, 0.25, "#63b6b2"],
    ["承", 0.25, 0.5, "#75a7df"],
    ["转", 0.5, 0.75, "#e36f70"],
    ["合", 0.75, 1, "#e7bd58"]
  ];

  // Soft stage background bands
  svg.append("g").attr("class", "timeline-stage-bands")
    .selectAll("rect").data(stageBands).join("rect")
    .attr("x", (d) => x(d[1])).attr("y", margin.top - 6)
    .attr("width", (d) => x(d[2]) - x(d[1]))
    .attr("height", height - margin.top - margin.bottom + 12)
    .attr("fill", (d) => d[3]).attr("class", "timeline-stage-band");

  // Stage labels above chart area
  svg.append("g").attr("class", "timeline-stages")
    .selectAll("text").data(stageBands).join("text")
    .attr("x", (d) => x(d[1] + d[2]) / 2).attr("y", margin.top - 10)
    .attr("text-anchor", "middle").attr("class", "timeline-stage")
    .attr("fill", (d) => d[3]).text((d) => d[0]);

  // Horizontal grid lines (Observable style — faint, minimal)
  const yTicks = d3.range(0, 1.01, 0.25);
  svg.append("g").attr("class", "timeline-grid")
    .selectAll("line").data(yTicks).join("line")
    .attr("x1", margin.left).attr("x2", width - margin.right)
    .attr("y1", (d) => y(d)).attr("y2", (d) => y(d))
    .attr("class", "timeline-grid-line");

  // Vertical guide lines between stage bands
  svg.append("g").attr("class", "timeline-guides")
    .selectAll("line").data(stageBands.slice(1)).join("line")
    .attr("x1", (d) => x(d[1])).attr("x2", (d) => x(d[1]))
    .attr("y1", margin.top - 6).attr("y2", height - margin.bottom + 6)
    .attr("class", "timeline-guide");

  // Axes — clean, minimal
  svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`)
    .attr("class", "timeline-axis")
    .call(d3.axisBottom(x).tickValues([0, 0.25, 0.5, 0.75, 1])
      .tickFormat((d) => `${Math.round(d * 100)}%`).tickSizeOuter(0));

  svg.append("g").attr("transform", `translate(${margin.left},0)`)
    .attr("class", "timeline-axis")
    .call(d3.axisLeft(y).ticks(4).tickFormat(d3.format(".0%")).tickSizeOuter(0));

  // Legend
  const legendG = svg.append("g").attr("class", "timeline-legend")
    .attr("transform", `translate(0,0)`);
  legendG.append("text").attr("class", "timeline-legend-note")
    .attr("x", width / 2).attr("y", 28).attr("text-anchor", "middle")
    .text("叙事结构对比 · 横轴为归一化进程");

  const legendItems = legendG.selectAll("g.timeline-legend-item")
    .data(series.slice(0, 4)).join("g").attr("class", "timeline-legend-item")
    .attr("transform", (_, i) => {
      const totalW = width - margin.left - margin.right;
      const startX = margin.left + 60;
      const gap = Math.min(220, (totalW - 120) / Math.max(1, series.length));
      return `translate(${startX + i * gap},70)`;
    });
  legendItems.append("line").attr("x1", 0).attr("x2", 22).attr("y1", 0).attr("y2", 0)
    .attr("stroke", (d) => d.color).attr("class", "timeline-legend-line");
  legendItems.append("circle").attr("cx", 11).attr("cy", 0).attr("r", 3.5)
    .attr("fill", (d) => d.color).attr("class", "timeline-legend-dot");
  legendItems.append("text").attr("x", 30).attr("y", 4)
    .text((d) => `${shortLabel(d.play.title, 8)} (${d.maxScene}场)`);

  // Series lines and areas
  const group = svg.append("g").selectAll("g").data(series).join("g").attr("class", "timeline-series");

  // Area fills with gradient
  series.forEach((s, i) => {
    const gradId = `timeline-grad-${i}`;
    const grad = svg.append("defs").append("linearGradient").attr("id", gradId)
      .attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 1);
    grad.append("stop").attr("offset", "0%").attr("stop-color", s.color).attr("stop-opacity", 0.15);
    grad.append("stop").attr("offset", "100%").attr("stop-color", s.color).attr("stop-opacity", 0.01);
    group.filter((_, idx) => idx === i)
      .append("path").attr("class", "timeline-area")
      .attr("fill", `url(#${gradId})`).attr("d", area(s.rhythm));
  });

  // Lines
  group.append("path").attr("class", "timeline-line")
    .attr("stroke", (d) => d.color).attr("d", (d) => line(d.rhythm));

  // Tooltip box — single point info
  const tooltipG = svg.append("g").attr("class", "timeline-tooltip").style("display", "none");
  tooltipG.append("rect").attr("rx", 6).attr("ry", 6).attr("class", "tooltip-bg");
  const tipDot = tooltipG.append("circle").attr("r", 5).attr("cx", 14).attr("cy", 17);
  const tipTitle = tooltipG.append("text").attr("x", 28).attr("y", 14).attr("class", "tooltip-row-title");
  const tipDetail = tooltipG.append("text").attr("x", 28).attr("y", 32).attr("class", "tooltip-row-detail");

  // Data points — hover shows single-point tooltip
  group.selectAll("circle").data(
    (d) => d.rhythm.map((p) => ({ ...p, color: d.color, playTitle: d.play.title, maxScene: d.maxScene }))
  ).join("circle").attr("class", "timeline-point")
    .attr("cx", (d) => x(d.progress)).attr("cy", (d) => y(Math.max(0, Math.min(1, d.tension || 0))))
    .attr("r", (d) => 3 + Math.sqrt(d.aria_count || 0) * 0.8)
    .attr("fill", (d) => d.color)
    .on("mouseenter", function (event, datum) {
      const [mx, my] = d3.pointer(event, svg.node());
      tipDot.attr("fill", datum.color);
      tipTitle.text(shortLabel(datum.playTitle, 14));
      tipDetail.text(`第 ${datum.scene_no} / ${datum.maxScene} 场 · 进程 ${Math.round(datum.progress * 100)}% · 张力 ${Number(datum.tension || 0).toFixed(2)} · 唱段 ${datum.aria_count || 0}`);
      const tw = Math.max(140, tipTitle.node().getBBox().width, tipDetail.node().getBBox().width) + 36;
      const rowsH = 48;
      const tipX = Math.min(mx + 14, width - tw - 8);
      const tipY = Math.max(margin.top - 6, Math.min(height - margin.bottom - rowsH - 6, my - rowsH / 2));
      tooltipG.attr("transform", `translate(${tipX},${tipY})`);
      tooltipG.select(".tooltip-bg").attr("width", tw).attr("height", rowsH);
      tooltipG.style("display", null);
      d3.select(this).attr("r", (d) => 5 + Math.sqrt(d.aria_count || 0) * 0.8);
    })
    .on("mouseleave", function () {
      tooltipG.style("display", "none");
      d3.select(this).attr("r", (d) => 3 + Math.sqrt(d.aria_count || 0) * 0.8);
    });
}

function drawNarrativeLegend(svg, series, width, margin) {
  const legend = svg.append("g").attr("class", "timeline-legend").attr("transform", `translate(0,0)`);
  legend
    .append("text")
    .attr("class", "timeline-legend-note")
    .attr("x", width / 2)
    .attr("y", 34)
    .attr("text-anchor", "middle")
    .text("叙事结构对比 · 横轴为归一化进程");

  const legendStart = margin.left + 210;
  const availableWidth = width - margin.left - margin.right - 250;
  const itemGap = Math.max(168, Math.min(230, availableWidth / Math.max(1, series.length)));
  const item = legend
    .selectAll("g.timeline-legend-item")
    .data(series.slice(0, 4))
    .join("g")
    .attr("class", "timeline-legend-item")
    .attr("transform", (_, index) => `translate(${legendStart + index * itemGap},82)`);

  item.append("line").attr("x1", 0).attr("x2", 24).attr("y1", 0).attr("y2", 0).attr("stroke", (d) => d.color).attr("class", "timeline-legend-line");
  item.append("circle").attr("cx", 12).attr("cy", 0).attr("r", 4).attr("fill", (d) => d.color).attr("class", "timeline-legend-dot");
  item.append("text").attr("x", 32).attr("y", 4).text((d) => `${shortLabel(d.play.title, 7)} (${d.maxScene}场)`);
}
