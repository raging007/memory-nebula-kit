/**
 * dsh-memory-nebula — browser half.
 *
 * A dedicated "记忆星图" panel in the left rail: the star map, the memory manager, the sync
 * console and a preview of exactly what the model will see. Data comes from the Host half's
 * `/memory-nebula/api/*` routes (plain fetch, same origin, custom header for mutations).
 */
window.__ModuleLoader__.load({
  id: 'dsh-memory-nebula',
  factory(require) {
    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    var useMemo = React.useMemo
    var useRef = React.useRef
    var useCallback = React.useCallback

    /* ------------------------------------------------------------------ api */

    function settle(response) {
      return response.json().then(
        function (body) {
          if (!response.ok) {
            var error = new Error((body && body.error) || 'HTTP ' + response.status)
            error.status = response.status
            throw error
          }
          return body
        },
        function () {
          throw new Error('HTTP ' + response.status)
        },
      )
    }

    function get(path) {
      return fetch('/memory-nebula' + path, { cache: 'no-store' }).then(settle)
    }

    function post(path, body) {
      return fetch('/memory-nebula' + path, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json', 'x-memory-nebula': '1' },
        body: JSON.stringify(body || {}),
      }).then(settle)
    }

    /* ---------------------------------------------------------------- format */

    function when(ms) {
      if (!ms) return '—'
      var delta = Date.now() - ms
      if (delta < 60000) return '刚刚'
      var minutes = Math.floor(delta / 60000)
      if (minutes < 60) return minutes + ' 分钟前'
      var hours = Math.floor(minutes / 60)
      if (hours < 24) return hours + ' 小时前'
      var days = Math.floor(hours / 24)
      if (days < 60) return days + ' 天前'
      return Math.floor(days / 30) + ' 个月前'
    }

    function date(ms) {
      if (!ms) return '—'
      var d = new Date(ms)
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    }

    var LAYER = {
      core: { label: '核心', tone: 'core' },
      important: { label: '重要', tone: 'important' },
      normal: { label: '普通', tone: 'normal' },
      faded: { label: '淡化', tone: 'faded' },
    }

    var KIND_LABEL = { fact: '事实', preference: '偏好', event: '事件', task: '待办', person: '人物', insight: '经验' }

    function layerLabel(layer) {
      return (LAYER[layer] || LAYER.normal).label
    }

    function hash(text) {
      var value = 2166136261
      for (var i = 0; i < text.length; i += 1) {
        value ^= text.charCodeAt(i)
        value = Math.imul(value, 16777619)
      }
      return Math.abs(value)
    }

    /* ---------------------------------------------------------------- styles */

    var CSS = [
      '.mn{display:flex;flex-direction:column;min-height:100%;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.6}',
      '.mn-head{display:flex;align-items:flex-end;gap:14px;padding:22px 26px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap}',
      '.mn-title{font-size:17px;font-weight:650;letter-spacing:.2px;margin:0;display:flex;align-items:center;gap:9px}',
      '.mn-title i{width:9px;height:9px;border-radius:50%;background:var(--dsw-alias-brand-primary);box-shadow:0 0 12px var(--dsw-alias-brand-primary)}',
      '.mn-meta{color:var(--dsw-alias-label-secondary);font-size:12px;display:flex;gap:14px;flex-wrap:wrap}',
      '.mn-meta b{color:var(--dsw-alias-label-primary);font-weight:600}',
      '.mn-head-right{margin-left:auto;display:flex;gap:8px;align-items:center}',
      '.mn-tabs{display:flex;gap:2px;padding:10px 26px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.mn-tab{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;padding:7px 12px 9px;border-bottom:2px solid transparent;cursor:pointer;border-radius:6px 6px 0 0}',
      '.mn-tab:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}',
      '.mn-tab.on{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}',
      '.mn-body{padding:18px 26px 40px;min-height:0}',
      '.mn-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:4px 10px;border-radius:7px;cursor:pointer;white-space:nowrap}',
      '.mn-btn:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.mn-btn[disabled]{opacity:.45;cursor:default}',
      '.mn-btn.primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}',
      '.mn-btn.danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}',
      '.mn-btn.ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary)}',
      '.mn-btn.ghost:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}',
      '.mn-chip{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:3px 9px;border-radius:20px;cursor:pointer}',
      '.mn-chip.on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}',
      '.mn-input,.mn-area{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;border-radius:8px;padding:7px 10px;outline:none}',
      '.mn-input:focus,.mn-area:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.mn-area{resize:vertical;min-height:74px;line-height:1.65}',
      '.mn-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}',
      '.mn-map{position:relative;height:560px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;overflow:hidden;background:radial-gradient(120% 100% at 50% 42%,color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent),transparent 62%),var(--dsw-alias-bg-layer-1)}',
      '.mn-map canvas{display:block;width:100%;height:100%;cursor:grab;touch-action:none}',
      '.mn-map canvas.dragging{cursor:grabbing}',
      '.mn-legend{position:absolute;left:14px;bottom:12px;display:flex;gap:12px;font-size:11px;color:var(--dsw-alias-label-secondary);pointer-events:none;flex-wrap:wrap;max-width:70%}',
      '.mn-legend span{display:flex;align-items:center;gap:5px}',
      '.mn-legend i{width:7px;height:7px;border-radius:50%;display:inline-block}',
      '.mn-map-hint{position:absolute;right:14px;bottom:12px;font-size:11px;color:var(--dsw-alias-label-secondary);pointer-events:none}',
      '.mn-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary);font-size:13px;text-align:center;padding:30px}',
      '.mn-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:14px 16px}',
      '.mn-card+.mn-card{margin-top:12px}',
      '.mn-card h3{margin:0 0 8px;font-size:13px;font-weight:650;display:flex;align-items:center;gap:8px}',
      '.mn-hint{color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.mn-list{display:flex;flex-direction:column;gap:8px;margin-top:12px}',
      '.mn-item{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:11px 13px;display:flex;flex-direction:column;gap:6px}',
      '.mn-item.core{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 6%,var(--dsw-alias-bg-layer-1))}',
      '.mn-item.important{border-left:3px solid var(--dsw-alias-brand-primary)}',
      '.mn-item.faded{opacity:.72;border-style:dashed}',
      '.mn-item-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.mn-item-text{font-size:13px;white-space:pre-wrap;word-break:break-word}',
      '.mn-badge{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:20px;font-size:11px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
      '.mn-badge.core{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 50%,transparent)}',
      '.mn-badge.important{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,transparent)}',
      '.mn-badge.faded{opacity:.8}',
      '.mn-tag{font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.9}',
      '.mn-spacer{margin-left:auto}',
      '.mn-split{display:grid;grid-template-columns:minmax(0,1fr);gap:14px}',
      '.mn-field{display:flex;flex-direction:column;gap:5px;margin-top:10px}',
      '.mn-field label{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.mn-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
      '.mn-grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}',
      '.mn-preview{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px;line-height:1.62;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px;max-height:340px;overflow:auto;color:var(--dsw-alias-label-secondary)}',
      '.mn-kv{display:grid;grid-template-columns:96px minmax(0,1fr);gap:4px 10px;font-size:12px}',
      '.mn-kv dt{color:var(--dsw-alias-label-secondary)}',
      '.mn-kv dd{margin:0;word-break:break-all}',
      '.mn-note{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.mn-err{color:var(--dsw-alias-state-error-primary);font-size:12px}',
      '.mn-ok{color:var(--dsw-alias-state-success-primary);font-size:12px}',
      '.mn-range{width:100%;accent-color:var(--dsw-alias-brand-primary)}',
      '.mn-hr{height:1px;background:var(--dsw-alias-border-l1);margin:14px 0;border:0}',
      '.mn-loading{padding:40px;text-align:center;color:var(--dsw-alias-label-secondary)}',
    ].join('')

    /* ------------------------------------------------------------------ icon */

    function Icon(props) {
      var size = (props && props.size) || 20
      var active = props && props.active
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('circle', { cx: 12, cy: 11, r: 3.1, fill: 'currentColor', opacity: active ? 1 : 0.9 }),
        h('circle', { cx: 12, cy: 11, r: 6.4, stroke: 'currentColor', strokeWidth: 1, opacity: 0.42 }),
        h('path', { d: 'M12 11 5.6 6.4M12 11l6.2-4.4M12 11l5.4 6M12 11l-5.6 5.6', stroke: 'currentColor', strokeWidth: 1, opacity: 0.55 }),
        h('circle', { cx: 5.4, cy: 6.2, r: 1.5, fill: 'currentColor' }),
        h('circle', { cx: 18.6, cy: 6.4, r: 1.2, fill: 'currentColor', opacity: 0.9 }),
        h('circle', { cx: 17.6, cy: 17.2, r: 1.35, fill: 'currentColor', opacity: 0.85 }),
        h('circle', { cx: 6.2, cy: 16.8, r: 1.1, fill: 'currentColor', opacity: 0.75 }),
      )
    }

    /* --------------------------------------------------------------- star map */

    function layoutGraph(graph) {
      var source = graph.nodes || []
      var capped = source.slice(0, 420)
      var index = new Map()
      var nodes = []
      capped.forEach(function (node) {
        var seed = hash(node.id)
        var ring = { core: 0.1, important: 0.36, normal: 0.66, faded: 0.9 }[node.layer]
        if (ring === undefined) ring = 0.66
        var angle = ((seed % 3600) / 3600) * Math.PI * 2
        var jitter = ((seed >> 7) % 100) / 100 * 0.1 - 0.05
        var radius = Math.max(0.03, ring + jitter)
        var item = { id: node.id, index: nodes.length, node: node, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
        index.set(node.id, item)
        nodes.push(item)
      })
      var links = (graph.edges || [])
        .map(function (edge) {
          var a = index.get(edge.a)
          var b = index.get(edge.b)
          if (!a || !b) return null
          return { a: a, b: b, weight: edge.weight || 0.35 }
        })
        .filter(Boolean)

      var iterations = nodes.length > 220 ? 40 : 80
      for (var step = 0; step < iterations; step += 1) {
        for (var i = 0; i < nodes.length; i += 1) {
          var a = nodes[i]
          for (var j = i + 1; j < nodes.length; j += 1) {
            var b = nodes[j]
            var dx = a.x - b.x
            var dy = a.y - b.y
            var d2 = dx * dx + dy * dy
            if (d2 < 1e-6) {
              dx = (i % 2 ? 1 : -1) * 0.001
              dy = (j % 2 ? 1 : -1) * 0.001
              d2 = 2e-6
            }
            var force = Math.min(0.05, 0.0009 / d2)
            var length = Math.sqrt(d2)
            a.x += (dx / length) * force
            a.y += (dy / length) * force
            b.x -= (dx / length) * force
            b.y -= (dy / length) * force
          }
        }
        for (var k = 0; k < links.length; k += 1) {
          var link = links[k]
          var lx = link.b.x - link.a.x
          var ly = link.b.y - link.a.y
          var dist = Math.sqrt(lx * lx + ly * ly) || 0.001
          var target = 0.24
          var pull = (dist - target) * 0.035 * link.weight
          link.a.x += (lx / dist) * pull
          link.a.y += (ly / dist) * pull
          link.b.x -= (lx / dist) * pull
          link.b.y -= (ly / dist) * pull
        }
        for (var m = 0; m < nodes.length; m += 1) {
          var node = nodes[m]
          var nodeLength = Math.sqrt(node.x * node.x + node.y * node.y) || 0.001
          if (nodeLength > 1.05) {
            node.x = (node.x / nodeLength) * 1.05
            node.y = (node.y / nodeLength) * 1.05
          }
          node.x *= 0.996
          node.y *= 0.996
        }
      }
      return { nodes: nodes, links: links }
    }

    function readColors() {
      var style = getComputedStyle(document.documentElement)
      var token = function (name, fallback) {
        var value = style.getPropertyValue(name)
        return value && value.trim() ? value.trim() : fallback
      }
      return {
        brand: token('--dsw-alias-brand-primary', '#4d6bfe'),
        label: token('--dsw-alias-label-primary', '#e8e8ec'),
        soft: token('--dsw-alias-label-secondary', '#9a9aa6'),
        line: token('--dsw-alias-border-l2', '#3a3a46'),
        warn: token('--dsw-alias-state-warn-primary', '#e0a33c'),
        idle: token('--dsw-alias-state-idle-primary', '#6b6b78'),
        error: token('--dsw-alias-state-error-primary', '#e05a4f'),
      }
    }

    function StarMap(props) {
      var graph = props.graph
      var selected = props.selectedId
      var onSelect = props.onSelect
      var canvasRef = useRef(null)
      var viewRef = useRef({ scale: 1, tx: 0, ty: 0 })
      var dragRef = useRef(null)
      var hoverRef = useRef(null)
      var layout = useMemo(function () {
        return layoutGraph(graph || { nodes: [], edges: [] })
      }, [graph])

      var draw = useCallback(function () {
        var canvas = canvasRef.current
        if (!canvas) return
        var rect = canvas.getBoundingClientRect()
        var dpr = Math.min(2, window.devicePixelRatio || 1)
        if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
          canvas.width = Math.round(rect.width * dpr)
          canvas.height = Math.round(rect.height * dpr)
        }
        var ctx = canvas.getContext('2d')
        if (!ctx) return
        var colors = readColors()
        var w = rect.width
        var hgt = rect.height
        var view = viewRef.current
        var scale = Math.min(w, hgt) * 0.44 * view.scale
        var cx = w / 2 + view.tx
        var cy = hgt / 2 + view.ty
        var place = function (item) {
          return { x: cx + item.x * scale, y: cy + item.y * scale }
        }
        var hovered = hoverRef.current
        var positions = new Map()
        for (var i = 0; i < layout.nodes.length; i += 1) positions.set(i, place(layout.nodes[i]))

        ctx.clearRect(0, 0, w, hgt)
        ctx.save()
        ctx.lineWidth = 1
        for (var e = 0; e < layout.links.length; e += 1) {
          var link = layout.links[e]
          var pa = positions.get(link.a.index)
          var pb = positions.get(link.b.index)
          if (!pa || !pb) continue
          var hot = selected && (link.a.id === selected || link.b.id === selected)
          ctx.globalAlpha = hot ? 0.5 : 0.1 + link.weight * 0.22
          ctx.strokeStyle = hot ? colors.brand : colors.line
          ctx.beginPath()
          ctx.moveTo(pa.x, pa.y)
          ctx.lineTo(pb.x, pb.y)
          ctx.stroke()
        }
        ctx.globalAlpha = 1
        var ordered = layout.nodes.map(function (item) {
          return { item: item, index: item.index, radius: 2.2 + item.node.importance * 7 + (item.node.pinned ? 2 : 0) - (item.node.layer === 'faded' ? 2 : 0) }
        })
        ordered.sort(function (a, b) {
          return a.radius - b.radius
        })
        for (var n = 0; n < ordered.length; n += 1) {
          var entry = ordered[n]
          var point = positions.get(entry.index)
          if (!point) continue
          var nodeData = entry.item.node
          var isSelected = selected === nodeData.id
          var isHover = hovered && hovered.id === nodeData.id
          var color = colors.soft
          if (nodeData.layer === 'core') color = colors.brand
          else if (nodeData.layer === 'important') color = colors.warn
          else if (nodeData.layer === 'faded') color = colors.idle
          var alpha = nodeData.layer === 'faded' ? 0.42 : 1
          if (nodeData.decayStage >= 2) alpha *= 0.86
          ctx.globalAlpha = alpha
          ctx.fillStyle = color
          if (nodeData.layer === 'core' || isSelected) {
            ctx.shadowColor = color
            ctx.shadowBlur = isSelected ? 20 : 12
          } else {
            ctx.shadowBlur = 0
          }
          ctx.beginPath()
          ctx.arc(point.x, point.y, entry.radius * (isHover ? 1.55 : isSelected ? 1.4 : 1), 0, Math.PI * 2)
          ctx.fill()
          ctx.shadowBlur = 0
          if (isSelected || isHover) {
            ctx.globalAlpha = 0.9
            ctx.strokeStyle = colors.label
            ctx.lineWidth = 1.2
            ctx.beginPath()
            ctx.arc(point.x, point.y, entry.radius + 3.5, 0, Math.PI * 2)
            ctx.stroke()
          }
        }
        ctx.globalAlpha = 1
        ctx.font = '11px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        var labelled = layout.nodes
          .filter(function (item) {
            return item.node.layer === 'core' || item.node.layer === 'important' || selected === item.node.id || (hovered && hovered.id === item.node.id)
          })
          .slice(0, 26)
        for (var l = 0; l < labelled.length; l += 1) {
          var item2 = labelled[l]
          var pos = positions.get(item2.index)
          if (!pos) continue
          var label = item2.node.label || ''
          if (!label) continue
          ctx.globalAlpha = selected === item2.node.id || (hovered && hovered.id === item2.node.id) ? 0.95 : 0.6
          ctx.fillStyle = colors.label
          ctx.fillText(label.length > 14 ? label.slice(0, 14) + '…' : label, pos.x, pos.y + 0.6 + 8 + item2.node.importance * 5)
        }
        ctx.restore()
      }, [layout, selected])

      useEffect(function () {
        draw()
        var onResize = function () {
          draw()
        }
        window.addEventListener('resize', onResize)
        return function () {
          window.removeEventListener('resize', onResize)
        }
      }, [draw])

      function locate(event) {
        var canvas = canvasRef.current
        if (!canvas) return null
        var rect = canvas.getBoundingClientRect()
        var view = viewRef.current
        var scale = Math.min(rect.width, rect.height) * 0.44 * view.scale
        var cx = rect.width / 2 + view.tx
        var cy = rect.height / 2 + view.ty
        var mx = event.clientX - rect.left
        var my = event.clientY - rect.top
        var best = null
        var bestDistance = Infinity
        for (var i = 0; i < layout.nodes.length; i += 1) {
          var node = layout.nodes[i]
          var x = cx + node.x * scale
          var y = cy + node.y * scale
          var distance = Math.hypot(mx - x, my - y)
          var radius = 7 + node.node.importance * 9 + (node.node.pinned ? 3 : 0)
          if (distance <= radius && distance < bestDistance) {
            best = node.node
            bestDistance = distance
          }
        }
        return { node: bestDistance <= 26 ? best : null, x: mx, y: my, rect: rect }
      }

      function onPointerDown(event) {
        var found = locate(event)
        dragRef.current = { x: event.clientX, y: event.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty, moved: false, node: found && found.node }
        event.currentTarget.classList.add('dragging')
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }

      function onPointerMove(event) {
        var drag = dragRef.current
        if (drag) {
          var dx = event.clientX - drag.x
          var dy = event.clientY - drag.y
          if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
          if (drag.moved) {
            viewRef.current.tx = drag.tx + dx
            viewRef.current.ty = drag.ty + dy
            draw()
          }
          return
        }
        var found = locate(event)
        var next = found ? found.node : null
        var previous = hoverRef.current
        if ((next && next.id) !== (previous && previous.id)) {
          hoverRef.current = next
          draw()
        }
      }

      function onPointerUp(event) {
        var drag = dragRef.current
        dragRef.current = null
        event.currentTarget.classList.remove('dragging')
        if (drag && !drag.moved && drag.node) onSelect(drag.node.id)
      }

      function onWheel(event) {
        event.preventDefault()
        var view = viewRef.current
        var factor = event.deltaY < 0 ? 1.12 : 0.89
        view.scale = Math.max(0.45, Math.min(3.2, view.scale * factor))
        draw()
      }

      return h(
        'div',
        { className: 'mn-map' },
        h('canvas', {
          ref: canvasRef,
          onPointerDown: onPointerDown,
          onPointerMove: onPointerMove,
          onPointerUp: onPointerUp,
          onPointerLeave: function () {
            hoverRef.current = null
            draw()
          },
          onWheel: onWheel,
        }),
        (layout.nodes.length === 0
          ? h('div', { className: 'mn-empty' }, '还没有记忆。\n跟助手说几件值得长期记住的事，或者在这个面板里手动添加一条。')
          : null),
        h(
          'div',
          { className: 'mn-legend' },
          h('span', null, h('i', { style: { background: 'var(--dsw-alias-brand-primary)' } }), '核心'),
          h('span', null, h('i', { style: { background: 'var(--dsw-alias-state-warn-primary)' } }), '重要'),
          h('span', null, h('i', { style: { background: 'var(--dsw-alias-label-secondary)' } }), '普通'),
          h('span', null, h('i', { style: { background: 'var(--dsw-alias-state-idle-primary)' } }), '淡化'),
        ),
        h('div', { className: 'mn-map-hint' }, '滚轮缩放 · 拖动平移 · 点击查看'),
      )
    }

    /* ------------------------------------------------------------ memory list */

    function MemoryRow(props) {
      var item = props.item
      var onChanged = props.onChanged
      var [editing, setEditing] = useState(false)
      var [draft, setDraft] = useState(item.text || item.preview || '')
      var [busy, setBusy] = useState(false)
      var [error, setError] = useState(null)

      function save() {
        setBusy(true)
        setError(null)
        post('/api/memory', { op: 'update', id: item.id, patch: { text: draft } })
          .then(function () {
            setEditing(false)
            setBusy(false)
            onChanged()
          })
          .catch(function (e) {
            setBusy(false)
            setError(String(e.message || e))
          })
      }

      function pin() {
        setBusy(true)
        post('/api/memory', { op: 'pin', id: item.id, pinned: !item.pinned })
          .then(function () {
            setBusy(false)
            onChanged()
          })
          .catch(function (e) {
            setBusy(false)
            setError(String(e.message || e))
          })
      }

      function forget() {
        if (!window.confirm('删除这条记忆？删除后无法恢复。')) return
        setBusy(true)
        post('/api/memory', { op: 'forget', id: item.id })
          .then(function () {
            setBusy(false)
            onChanged()
          })
          .catch(function (e) {
            setBusy(false)
            setError(String(e.message || e))
          })
      }

      return h(
        'div',
        { className: 'mn-item ' + (item.layer || 'normal') },
        h(
          'div',
          { className: 'mn-item-head' },
          h('span', { className: 'mn-badge ' + (item.layer || '') }, layerLabel(item.layer)),
          h('span', null, date(item.createdAt)),
          h('span', null, '重要度 ' + (Math.round((item.importance || 0) * 100) / 100)),
          item.decayStage >= 1 ? h('span', null, '已精简 ' + item.decayStage + ' 级') : null,
          item.accessCount ? h('span', null, '被用到 ' + item.accessCount + ' 次') : null,
          h('span', { className: 'mn-spacer' }),
          h('span', { className: 'mn-tag' }, (item.tags || []).join(' · ')),
        ),
        editing
          ? h(
              'div',
              { className: 'mn-field' },
              h('textarea', { className: 'mn-area', value: draft, onChange: function (event) { setDraft(event.target.value) } }),
              h(
                'div',
                { className: 'mn-row' },
                h('button', { className: 'mn-btn primary', disabled: busy, onClick: save }, busy ? '保存中…' : '保存'),
                h('button', { className: 'mn-btn ghost', onClick: function () { setEditing(false); setDraft(item.text || item.preview || '') } }, '取消'),
                h('span', { className: 'mn-hint' }, '修改会重置这条记忆的老化计时。'),
              ),
            )
          : h('div', { className: 'mn-item-text' }, item.text || item.preview || item.summary || '（无内容）'),
        h(
          'div',
          { className: 'mn-row' },
          h('button', { className: 'mn-btn ghost', disabled: busy, onClick: pin }, item.pinned ? '取消核心' : '设为核心'),
          h('button', { className: 'mn-btn ghost', disabled: busy, onClick: function () { setDraft(item.text || item.preview || ''); setEditing(!editing) } }, editing ? '收起编辑' : '编辑'),
          h('button', { className: 'mn-btn ghost danger', disabled: busy, onClick: forget }, '遗忘'),
          error ? h('span', { className: 'mn-err' }, error) : null,
        ),
      )
    }

    function MemoryList(props) {
      var [query, setQuery] = useState('')
      var [layer, setLayer] = useState('all')
      var [items, setItems] = useState(null)
      var [error, setError] = useState(null)
      var [draft, setDraft] = useState('')
      var [adding, setAdding] = useState(false)
      var [busy, setBusy] = useState(false)
      var onChanged = props.onChanged
      var decay = props.decay || {}

      var load = useCallback(function () {
        var params = '?limit=300' + (query ? '&q=' + encodeURIComponent(query) : '') + (layer !== 'all' ? '&layer=' + layer : '')
        get('/api/memories' + params)
          .then(function (body) {
            setItems(body.items || [])
            setError(null)
          })
          .catch(function (e) {
            setError(String(e.message || e))
          })
      }, [query, layer])

      useEffect(function () {
        var alive = true
        var timer = setTimeout(function () {
          if (alive) load()
        }, query ? 220 : 0)
        return function () {
          alive = false
          clearTimeout(timer)
        }
      }, [load, query])

      function add() {
        if (!draft.trim()) return
        setBusy(true)
        post('/api/memory', { op: 'create', text: draft })
          .then(function () {
            setBusy(false)
            setDraft('')
            setAdding(false)
            load()
            onChanged()
          })
          .catch(function (e) {
            setBusy(false)
            setError(String(e.message || e))
          })
      }

      var pinned = (items || []).filter(function (item) { return item.layer === 'core' || item.layer === 'important' || item.pinned })
      var rest = (items || []).filter(function (item) { return !(item.layer === 'core' || item.layer === 'important' || item.pinned) })

      return h(
        'div',
        null,
        h(
          'div',
          { className: 'mn-card' },
          h(
            'div',
            { className: 'mn-row' },
            h('input', {
              className: 'mn-input',
              style: { flex: '1 1 240px' },
              placeholder: '模糊搜索：关键词、标签、半句话都行…',
              value: query,
              onChange: function (event) { setQuery(event.target.value) },
            }),
            h('button', { className: 'mn-btn primary', onClick: function () { setAdding(!adding) } }, adding ? '收起' : '手动添加'),
            h('button', { className: 'mn-btn ghost', onClick: load }, '刷新'),
          ),
          h(
            'div',
            { className: 'mn-row', style: { marginTop: 10 } },
            ['all', 'core', 'important', 'normal', 'faded'].map(function (key) {
              return h(
                'button',
                {
                  key: key,
                  className: 'mn-chip' + (layer === key ? ' on' : ''),
                  onClick: function () { setLayer(key) },
                },
                key === 'all' ? '全部' : layerLabel(key),
              )
            }),
          ),
          adding
            ? h(
                'div',
                { className: 'mn-field' },
                h('textarea', {
                  className: 'mn-area',
                  placeholder: '一句完整、能独立看懂的话。例如：用户偏好中文回答，先给结论再展开。',
                  value: draft,
                  onChange: function (event) { setDraft(event.target.value) },
                }),
                h(
                  'div',
                  { className: 'mn-row' },
                  h('button', { className: 'mn-btn primary', disabled: busy, onClick: add }, busy ? '保存中…' : '记下来'),
                  h('span', { className: 'mn-hint' }, '默认普通层级，会随时间逐渐精简；之后可设为核心。'),
                ),
              )
            : null,
          error ? h('div', { className: 'mn-err', style: { marginTop: 8 } }, error) : null,
        ),
        items === null
          ? h('div', { className: 'mn-loading' }, '读取记忆…')
          : h(
              'div',
              null,
              pinned.length
                ? h(
                    'div',
                    { className: 'mn-list' },
                    h('div', { className: 'mn-hint', style: { marginTop: 14 } }, '核心与重要（不随时间淡化）'),
                    pinned.map(function (item) {
                      return h(MemoryRow, { key: item.id, item: item, onChanged: function () { load(); onChanged() } })
                    }),
                  )
                : null,
              rest.length
                ? h(
                    'div',
                    { className: 'mn-list' },
                    h('div', { className: 'mn-hint', style: { marginTop: 14 } }, '普通与淡化（' + (decay.afterDays || 100) + ' 天后逐级精简，' + (decay.forgetDays || 300) + ' 天后只剩要点）'),
                    rest.map(function (item) {
                      return h(MemoryRow, { key: item.id, item: item, onChanged: function () { load(); onChanged() } })
                    }),
                  )
                : null,
              !items.length ? h('div', { className: 'mn-loading' }, '没有匹配的记忆。') : null,
            ),
      )
    }

    /* ---------------------------------------------------------------- sync */

    function SyncPanel(props) {
      var [status, setStatus] = useState(null)
      var [error, setError] = useState(null)
      var [busy, setBusy] = useState(false)
      var [folder, setFolder] = useState('')
      var [report, setReport] = useState(null)
      var [peer, setPeer] = useState({ name: '', url: '', token: '' })
      var onChanged = props.onChanged

      var load = useCallback(function () {
        get('/api/sync')
          .then(function (body) {
            setStatus(body.status)
            setFolder(body.status.folder || '')
            setError(null)
          })
          .catch(function (e) { setError(String(e.message || e)) })
      }, [])

      useEffect(function () { load() }, [load])

      function saveSync(patch) {
        setBusy(true)
        post('/api/sync', { action: 'settings', patch: patch })
          .then(function (body) {
            setStatus(body.status)
            setBusy(false)
            onChanged()
          })
          .catch(function (e) {
            setBusy(false)
            setError(String(e.message || e))
          })
      }

      function run() {
        setBusy(true)
        setError(null)
        post('/api/sync', { action: 'run' })
          .then(function (body) {
            setReport(body.report)
            setStatus(body.status)
            setBusy(false)
            onChanged()
          })
          .catch(function (e) {
            setBusy(false)
            setError(String(e.message || e))
          })
      }

      function importSessions() {
        setBusy(true)
        post('/api/sync', { action: 'import-sessions' })
          .then(function (body) {
            setReport({ sessions: body.result })
            setStatus(body.status)
            setBusy(false)
          })
          .catch(function (e) {
            setBusy(false)
            setError(String(e.message || e))
          })
      }

      function addPeer() {
        if (!peer.url.trim()) return
        var peers = (status.peers || []).concat([{ name: peer.name.trim() || 'peer', url: peer.url.trim(), token: peer.token.trim() }])
        saveSync({ peers: peers })
        setPeer({ name: '', url: '', token: '' })
      }

      if (!status) return h('div', { className: 'mn-loading' }, error || '读取同步状态…')

      var last = report || status.lastReport
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'mn-card' },
          h('h3', null, '跨设备同步'),
          h(
            'div',
            { className: 'mn-hint' },
            '同一账号下的设备共用一套长期记忆。两种通道可以同时用：同步文件夹（OneDrive、坚果云、Syncthing 都行）适合不同网络；对端地址适合同一局域网里的另一台机器。',
          ),
          h(
            'div',
            { className: 'mn-row', style: { marginTop: 12 } },
            h('button', {
              className: 'mn-chip' + (status.enabled ? ' on' : ''),
              onClick: function () { saveSync({ enabled: !status.enabled }) },
            }, status.enabled ? '同步已开启' : '同步已关闭'),
            h('span', { className: 'mn-hint' }, '设备 ' + status.device.name + ' · ' + (status.account === 'local' ? '未登录账号（按本机合并）' : '账号 ' + status.account.slice(0, 10) + '…')),
          ),
          h(
            'div',
            { className: 'mn-field' },
            h('label', null, '同步文件夹'),
            h(
              'div',
              { className: 'mn-row' },
              h('input', { className: 'mn-input', value: folder, placeholder: '例如 D:\\\\Sync\\dsh-memory', onChange: function (e) { setFolder(e.target.value) } }),
              h('button', { className: 'mn-btn', disabled: busy, onClick: function () { saveSync({ folder: folder }) } }, '保存路径'),
            ),
          ),
          h(
            'div',
            { className: 'mn-grid3', style: { marginTop: 12 } },
            h(
              'div',
              { className: 'mn-field' },
              h('label', null, '自动同步间隔（分钟，0=只手动）'),
              h('input', {
                className: 'mn-input',
                type: 'number',
                min: 0,
                value: status.intervalMinutes,
                onChange: function (e) { saveSync({ intervalMinutes: Number(e.target.value) }) },
              }),
            ),
            h(
              'div',
              { className: 'mn-field' },
              h('label', null, '会话归档'),
              h(
                'select',
                { className: 'mn-input', value: status.sessions, onChange: function (e) { saveSync({ sessions: e.target.value }) } },
                h('option', { value: 'export' }, '导出到同步文件夹'),
                h('option', { value: 'off' }, '不导出'),
              ),
            ),
            h(
              'div',
              { className: 'mn-field' },
              h('label', null, '插件清单'),
              h('button', { className: 'mn-chip' + (status.plugins ? ' on' : ''), onClick: function () { saveSync({ plugins: !status.plugins }) } }, status.plugins ? '随快照同步' : '不同步'),
            ),
          ),
          h(
            'div',
            { className: 'mn-row', style: { marginTop: 10 } },
            h(
              'button',
              { className: 'mn-chip' + (status.sharePackage ? ' on' : ''), onClick: function () { saveSync({ sharePackage: !status.sharePackage }) } },
              status.sharePackage ? '插件包随同步夹' : '插件包不随同步夹',
            ),
            h('span', { className: 'mn-hint' }, '开启后插件代码会复制到 同步文件夹/plugins/memory-nebula/，另一台不用再拷 zip。'),
          ),
          h(
            'div',
            { className: 'mn-row', style: { marginTop: 10 } },
            h(
              'button',
              { className: 'mn-chip' + (status.shareInventory ? ' on' : ''), onClick: function () { saveSync({ shareInventory: !status.shareInventory }) } },
              status.shareInventory ? '插件清单随同步开' : '插件清单随同步关',
            ),
            h('span', { className: 'mn-hint' }, '开启后每次同步会把插件清单和各插件配置写到 同步夹/config/plugins.json，另一台的 agent 可据此安装与配置。'),
          ),
          h(
            'div',
            { className: 'mn-row', style: { marginTop: 10 } },
            h(
              'button',
              { className: 'mn-chip' + (status.git ? ' on' : ''), onClick: function () { saveSync({ git: !status.git }) } },
              status.git ? 'git 自动同步开' : 'git 自动同步关',
            ),
            h('span', { className: 'mn-hint' }, '同步夹是 git clone 时打开：每次同步先 pull，写完 commit + push（凭据用系统 git，不会存到插件里）。'),
          ),
          h(
            'div',
            { className: 'mn-row', style: { marginTop: 10 } },
            h(
              'button',
              { className: 'mn-chip' + (status.syncConfig ? ' on' : ''), onClick: function () { saveSync({ syncConfig: !status.syncConfig }) } },
              status.syncConfig ? '配置随同步开' : '配置随同步关',
            ),
            h('span', { className: 'mn-hint' }, '把预算/老化/同步节奏写进 同步夹/config/desired.json；另一台 pull 后自动应用，folder、令牌等本机项不参与。'),
          ),
          h(
            'div',
            { className: 'mn-row', style: { marginTop: 14 } },
            h('button', { className: 'mn-btn primary', disabled: busy, onClick: run }, busy ? '同步中…' : '立即同步'),
            h('button', { className: 'mn-btn', disabled: busy, onClick: importSessions }, '导入其他设备的会话'),
            h('span', { className: 'mn-hint' }, '导入的会话需要重启 DSH 后才会出现在侧栏。'),
          ),
          error ? h('div', { className: 'mn-err', style: { marginTop: 8 } }, error) : null,
        ),
        h(
          'div',
          { className: 'mn-card' },
          h('h3', null, '对端设备'),
          h('div', { className: 'mn-hint' }, '在另一台设备的同一个面板里复制它的同步令牌，填到这里。'),
          (status.peers || []).length
            ? h(
                'div',
                { className: 'mn-list' },
                status.peers.map(function (item, index) {
                  return h(
                    'div',
                    { key: item.url + index, className: 'mn-item' },
                    h(
                      'div',
                      { className: 'mn-row' },
                      h('b', null, item.name),
                      h('span', { className: 'mn-hint' }, item.url),
                      h('span', { className: 'mn-spacer' }),
                      h('button', {
                        className: 'mn-btn ghost',
                        onClick: function () { saveSync({ peers: status.peers.filter(function (_, i) { return i !== index }) }) },
                      }, '移除'),
                    ),
                  )
                }),
              )
            : h('div', { className: 'mn-hint', style: { marginTop: 8 } }, '还没有添加对端。'),
          h(
            'div',
            { className: 'mn-grid3', style: { marginTop: 12 } },
            h('input', { className: 'mn-input', placeholder: '名称', value: peer.name, onChange: function (e) { setPeer(Object.assign({}, peer, { name: e.target.value })) } }),
            h('input', { className: 'mn-input', placeholder: 'http://192.168.1.5:3080', value: peer.url, onChange: function (e) { setPeer(Object.assign({}, peer, { url: e.target.value })) } }),
            h('input', { className: 'mn-input', placeholder: '同步令牌', value: peer.token, onChange: function (e) { setPeer(Object.assign({}, peer, { token: e.target.value })) } }),
          ),
          h(
            'div',
            { className: 'mn-row', style: { marginTop: 10 } },
            h('button', { className: 'mn-btn', onClick: addPeer }, '添加对端'),
            h('span', { className: 'mn-hint' }, '本机令牌：'),
            h('code', { style: { fontSize: 11, wordBreak: 'break-all' } }, status.token),
          ),
        ),
        h(
          'div',
          { className: 'mn-card' },
          h('h3', null, '上次同步'),
          last
            ? h(
                'div',
                null,
                h(
                  'dl',
                  { className: 'mn-kv' },
                  h('dt', null, '时间'), h('dd', null, when(last.at)),
                  h('dt', null, '结果'), h('dd', null, last.error || last.skipped || (last.folder && last.folder.ok ? '完成' : '未完成')),
                  last.folder ? h('dt', null, '文件夹') : null,
                  last.folder ? h('dd', null, last.folder.path || last.folder.error || last.folder.skipped || '—') : null,
                  last.folder && last.folder.peers ? h('dt', null, '合并') : null,
                  last.folder && last.folder.peers
                    ? h('dd', null, last.folder.peers.length + ' 个设备快照：' + last.folder.peers.map(function (item) {
                        return (item.device || item.source) + (item.ok ? ' +' + (item.added || 0) + ' ~' + (item.updated || 0) : '（' + (item.error || item.skipped) + '）')
                      }).join('，'))
                    : null,
                  (last.peers || []).length ? h('dt', null, '对端') : null,
                  (last.peers || []).length
                    ? h('dd', null, last.peers.map(function (item) {
                        return item.name + (item.error ? ' ✕ ' + item.error : ' ✓')
                      }).join('，'))
                    : null,
                  last.sessions && last.sessions.exported ? h('dt', null, '会话导出') : null,
                  last.sessions && last.sessions.exported ? h('dd', null, last.sessions.exported.length + ' 个（跳过写入中的 ' + (last.sessions.skipped || 0) + ' 个）') : null,
                  last.import && last.import.imported ? h('dt', null, '会话导入') : null,
                  last.import && last.import.imported ? h('dd', null, last.import.imported.length + ' 个，重启后可见') : null,
                  last.config ? h('dt', null, '配置') : null,
                  last.config
                    ? h('dd', null, last.config.error
                        ? last.config.error
                        : last.config.applied
                          ? '应用了 ' + (last.config.from || '对端') + ' 的 v' + last.config.version
                          : last.config.published
                            ? '发布了本机 v' + last.config.version
                            : '无变化（v' + last.config.version + '）')
                    : null,
                  last.inventory ? h('dt', null, '插件清单') : null,
                  last.inventory
                    ? h('dd', null, last.inventory.error
                        ? last.inventory.error
                        : last.inventory.written
                          ? '已更新（' + (last.inventory.bundles || 0) + ' 个插件 / ' + (last.inventory.rows || 0) + ' 条配置）'
                          : '无变化')
                    : null,
                ),
                last.folder && last.folder.peers
                  ? h(
                      'div',
                      { style: { marginTop: 10 } },
                      h('div', { className: 'mn-hint' }, '插件清单差异'),
                      last.folder.peers.map(function (item) {
                        if (!item.plugins) return null
                        var missing = (item.plugins.missingHere || []).concat(item.plugins.missingThere || [])
                        return h('div', { key: (item.device || '') + 'diff', className: 'mn-hint' },
                          (item.device || '对端') + '：' + (missing.length
                            ? '差异 ' + missing.map(function (bundle) { return bundle.name + (bundle.version ? '@' + bundle.version : '') }).join('、')
                            : '插件一致'))
                      }),
                    )
                  : null,
              )
            : h('div', { className: 'mn-hint' }, '还没有同步过。'),
        ),
      )
    }

    /* -------------------------------------------------------------- injection */

    function InjectPanel(props) {
      var [settings, setSettings] = useState(null)
      var [prompt, setPrompt] = useState(null)
      var [text, setText] = useState('')
      var [query, setQuery] = useState('')
      var [preview, setPreview] = useState(null)
      var [error, setError] = useState(null)
      var [busy, setBusy] = useState(false)
      var onChanged = props.onChanged

      useEffect(function () {
        get('/api/state')
          .then(function (body) { setSettings(body.settings); setPrompt(body.prompt || null) })
          .catch(function (e) { setError(String(e.message || e)) })
      }, [])

      useEffect(function () {
        var alive = true
        var timer = setTimeout(function () {
          get('/api/preview?q=' + encodeURIComponent(query))
            .then(function (body) { if (alive) setPreview(body) })
            .catch(function (e) { if (alive) setError(String(e.message || e)) })
        }, 200)
        return function () {
          alive = false
          clearTimeout(timer)
        }
      }, [query])

      function save(patch) {
        setBusy(true)
        post('/api/settings', { patch: patch })
          .then(function (body) {
            setSettings(body.settings)
            setBusy(false)
            onChanged()
          })
          .catch(function (e) {
            setBusy(false)
            setError(String(e.message || e))
          })
      }

      function runDecay() {
        setBusy(true)
        post('/api/decay', {})
          .then(function (body) {
            setBusy(false)
            setText('本轮精简 ' + body.result.compressed + ' 条、淡化 ' + body.result.faded + ' 条、清除 ' + body.result.purged + ' 条。')
            onChanged()
          })
          .catch(function (e) {
            setBusy(false)
            setError(String(e.message || e))
          })
      }

      if (!settings) return h('div', { className: 'mn-loading' }, error || '读取注入设置…')

      return h(
        'div',
        null,
        h(
          'div',
          { className: 'mn-card' },
          h('h3', null, '注入预算'),
          h('div', { className: 'mn-hint' }, '每轮只把「核心与重要」加上「与当前这句话相关」的记忆放进提示词，条数和字数都有上限。这里改的是本机设置。'),
          prompt
            ? h('div', { className: 'mn-hint', style: { marginTop: 6 } },
                '已接入 ' + (prompt.sections || 0) + ' 个会话' + (prompt.liveAgents === null ? '' : '（当前活跃 ' + prompt.liveAgents + '）') +
                (prompt.errors && prompt.errors.length ? '；最近一次注册失败：' + prompt.errors[prompt.errors.length - 1].message : ''))
            : null,
          h(
            'div',
            { className: 'mn-grid2', style: { marginTop: 10 } },
            h(
              'div',
              { className: 'mn-field' },
              h('label', null, '总字数上限：' + settings.promptBudgetChars),
              h('input', {
                className: 'mn-range',
                type: 'range',
                min: 300,
                max: 3000,
                step: 50,
                value: settings.promptBudgetChars,
                onChange: function (e) { save({ promptBudgetChars: Number(e.target.value) }) },
              }),
            ),
            h(
              'div',
              { className: 'mn-field' },
              h('label', null, '核心/重要字数上限：' + settings.coreBudgetChars),
              h('input', {
                className: 'mn-range',
                type: 'range',
                min: 120,
                max: 1500,
                step: 20,
                value: settings.coreBudgetChars,
                onChange: function (e) { save({ coreBudgetChars: Number(e.target.value) }) },
              }),
            ),
            h(
              'div',
              { className: 'mn-field' },
              h('label', null, '相关条数上限：' + settings.relevantLimit),
              h('input', {
                className: 'mn-range',
                type: 'range',
                min: 1,
                max: 20,
                step: 1,
                value: settings.relevantLimit,
                onChange: function (e) { save({ relevantLimit: Number(e.target.value) }) },
              }),
            ),
            h(
              'div',
              { className: 'mn-field' },
              h('label', null, '最低相关度：' + settings.minScore),
              h('input', {
                className: 'mn-range',
                type: 'range',
                min: 0,
                max: 0.6,
                step: 0.01,
                value: settings.minScore,
                onChange: function (e) { save({ minScore: Number(e.target.value) }) },
              }),
            ),
          ),
          h(
            'div',
            { className: 'mn-row', style: { marginTop: 10 } },
            h('button', { className: 'mn-btn', disabled: busy, onClick: runDecay }, '立即执行一次精简'),
            text ? h('span', { className: 'mn-ok' }, text) : null,
          ),
        ),
        h(
          'div',
          { className: 'mn-card' },
          h('h3', null, '老化规则'),
          h(
            'div',
            { className: 'mn-grid3' },
            h(
              'div',
              { className: 'mn-field' },
              h('label', null, '几天后开始精简'),
              h('input', {
                className: 'mn-input',
                type: 'number',
                min: 1,
                value: settings.decay.afterDays,
                onChange: function (e) { save({ decay: { afterDays: Number(e.target.value) } }) },
              }),
            ),
            h(
              'div',
              { className: 'mn-field' },
              h('label', null, '几天后二次精简'),
              h('input', {
                className: 'mn-input',
                type: 'number',
                min: 2,
                value: settings.decay.stage2Days,
                onChange: function (e) { save({ decay: { stage2Days: Number(e.target.value) } }) },
              }),
            ),
            h(
              'div',
              { className: 'mn-field' },
              h('label', null, '几天后只剩要点'),
              h('input', {
                className: 'mn-input',
                type: 'number',
                min: 3,
                value: settings.decay.forgetDays,
                onChange: function (e) { save({ decay: { forgetDays: Number(e.target.value) } }) },
              }),
            ),
          ),
          h('div', { className: 'mn-hint', style: { marginTop: 8 } },
            '被用到的记忆会重新变新；核心与重要层级不参与老化。彻底清除在「只剩要点」之后 ' + settings.decay.purgeDays + ' 天。'),
        ),
        h(
          'div',
          { className: 'mn-card' },
          h('h3', null, '现在会注入什么'),
          h('input', {
            className: 'mn-input',
            placeholder: '输入一句话，模拟这一轮的模型视角……',
            value: query,
            onChange: function (e) { setQuery(e.target.value) },
          }),
          preview
            ? h(
                'div',
                null,
                h('div', { className: 'mn-row', style: { marginTop: 10 } },
                  h('span', { className: 'mn-badge' }, '约 ' + preview.tokens + ' tokens'),
                  h('span', { className: 'mn-hint' }, preview.text ? '节选而非全量' : '没有可注入的记忆')),
                h('pre', { className: 'mn-preview', style: { marginTop: 8 } }, preview.text || '（本轮不会注入任何记忆）'),
              )
            : null,
        ),
      )
    }

    /* ------------------------------------------------------------------ shell */

    function Panel() {
      var [tab, setTab] = useState('map')
      var [state, setState] = useState(null)
      var [graph, setGraph] = useState({ nodes: [], edges: [] })
      var [selectedId, setSelectedId] = useState(null)
      var [detail, setDetail] = useState(null)
      var [error, setError] = useState(null)
      var [tick, setTick] = useState(0)

      var refresh = useCallback(function () {
        setTick(function (value) { return value + 1 })
      }, [])

      useEffect(function () {
        var alive = true
        Promise.all([get('/api/state'), get('/api/graph')])
          .then(function (results) {
            if (!alive) return
            setState(results[0])
            setGraph(results[1])
            setError(null)
          })
          .catch(function (e) {
            if (alive) setError(String(e.message || e))
          })
        return function () {
          alive = false
        }
      }, [tick])

      useEffect(function () {
        if (!selectedId) {
          setDetail(null)
          return
        }
        var id = selectedId
        get('/api/memory?id=' + encodeURIComponent(id))
          .then(function (body) { setDetail(body.item) })
          .catch(function () { setDetail(null) })
      }, [selectedId, tick])

      function updateSelected(patch) {
        if (!selectedId) return
        post('/api/memory', { op: 'update', id: selectedId, patch: patch })
          .then(function () { refresh() })
          .catch(function (e) { setError(String(e.message || e)) })
      }

      function forgetSelected() {
        if (!selectedId || !window.confirm('删除这条记忆？')) return
        post('/api/memory', { op: 'forget', id: selectedId })
          .then(function () {
            setSelectedId(null)
            refresh()
          })
          .catch(function (e) { setError(String(e.message || e)) })
      }

      var stats = state ? state.stats : null

      return h(
        'div',
        { className: 'mn' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'mn-head' },
          h('h1', { className: 'mn-title' }, h('i', null), '记忆星图'),
          h(
            'div',
            { className: 'mn-meta' },
            stats
              ? h('span', null, '共 ', h('b', null, stats.total), ' 条')
              : null,
            stats
              ? h('span', null, '核心 ', h('b', null, stats.counts.core || 0), ' · 重要 ', h('b', null, stats.counts.important || 0), ' · 淡化 ', h('b', null, stats.counts.faded || 0))
              : null,
            state ? h('span', null, state.device.name) : null,
            state && state.prompt && state.prompt.sections ? h('span', null, '已接入 ', h('b', null, state.prompt.sections), ' 个会话') : null,
            state && state.account ? h('span', null, '账号已绑定') : h('span', null, '本机记忆'),
          ),
          h(
            'div',
            { className: 'mn-head-right' },
            error ? h('span', { className: 'mn-err' }, error) : null,
            h('button', { className: 'mn-btn ghost', onClick: refresh }, '刷新'),
          ),
        ),
        h(
          'div',
          { className: 'mn-tabs' },
          h('button', { className: 'mn-tab' + (tab === 'map' ? ' on' : ''), onClick: function () { setTab('map') } }, '星图'),
          h('button', { className: 'mn-tab' + (tab === 'list' ? ' on' : ''), onClick: function () { setTab('list') } }, '记忆'),
          h('button', { className: 'mn-tab' + (tab === 'sync' ? ' on' : ''), onClick: function () { setTab('sync') } }, '跨设备'),
          h('button', { className: 'mn-tab' + (tab === 'inject' ? ' on' : ''), onClick: function () { setTab('inject') } }, '注入'),
        ),
        h(
          'div',
          { className: 'mn-body' },
          tab === 'map'
            ? h(
                'div',
                null,
                h(StarMap, { graph: graph, selectedId: selectedId, onSelect: setSelectedId }),
                detail
                  ? h(
                      'div',
                      { className: 'mn-card', style: { marginTop: 12 } },
                      h(
                        'h3',
                        null,
                        '记忆详情',
                        h('span', { className: 'mn-spacer' }),
                        h('button', { className: 'mn-btn ghost', onClick: function () { setSelectedId(null) } }, '关闭'),
                      ),
                      h(
                        'div',
                        { className: 'mn-item-head' },
                        h('span', { className: 'mn-badge ' + detail.layer }, layerLabel(detail.layer)),
                        h('span', null, date(detail.createdAt)),
                        h('span', null, '重要度 ' + detail.importance),
                        (detail.tags || []).length ? h('span', { className: 'mn-tag' }, detail.tags.join(' · ')) : null,
                      ),
                      h('div', { className: 'mn-item-text', style: { marginTop: 6 } }, detail.text || detail.summary || '（内容已淡化）'),
                      h(
                        'div',
                        { className: 'mn-row', style: { marginTop: 10 } },
                        h('button', { className: 'mn-btn', onClick: function () { updateSelected({ pinned: !detail.pinned }) } }, detail.pinned ? '取消核心' : '设为核心'),
                        h('button', { className: 'mn-btn ghost', onClick: function () {
                          var next = window.prompt('修改这条记忆：', detail.text || detail.summary || '')
                          if (next && next.trim()) updateSelected({ text: next.trim() })
                        } }, '编辑'),
                        h('button', { className: 'mn-btn ghost danger', onClick: forgetSelected }, '遗忘'),
                      ),
                    )
                  : h('div', { className: 'mn-hint', style: { marginTop: 10 } }, '点击星点查看详情；核心是金色光晕，重要偏暖色，淡化会变暗。'),
              )
            : null,
          tab === 'list' ? h(MemoryList, { onChanged: refresh, decay: state && state.settings ? state.settings.decay : null }) : null,
          tab === 'sync' ? h(SyncPanel, { onChanged: refresh }) : null,
          tab === 'inject' ? h(InjectPanel, { onChanged: refresh }) : null,
        ),
      )
    }

    var exports = { inject: ['slots'] }
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    exports.apply = function (ctx) {
      ctx.slots.inject('sidebar.panellist', function () {
        return ctx.slots.register(
          { name: 'sidebar.panellist', id: 'memory-nebula', order: 24, label: function () { return '记忆星图' } },
          Icon,
        )
      })
      ctx.slots.inject('main', function () {
        return ctx.slots.register({ name: 'main', key: 'memory-nebula' }, Panel)
      })
    }
    Object.defineProperty(exports, '__test', { value: { layoutGraph, Panel, StarMap, MemoryList, SyncPanel, InjectPanel }, enumerable: false })
    return exports
  },
})
