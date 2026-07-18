/* ===================================================================
   INTERACTIVE BUBBLE MAP — Wallet & Token Network Visualization
   Canvas-based force-directed graph with:
   - Stable physics (nodes stay on screen, settle quickly)
   - Hover tooltips showing wallet/token info
   - Click to open Solscan.io or token detail
   - Color-coded by type (wallet, token, alpha, sniper, cluster)
   =================================================================== */

const BubbleMap = (() => {
    'use strict';

    const BMCONFIG = {
        SOLSCAN_URL: 'https://solscan.io/',
        NODE_COLORS: {
            token:    { fill: '#9945FF', stroke: '#B87AFF', glow: 'rgba(153,69,255,0.3)' },
            wallet:   { fill: '#14F195', stroke: '#5BFFC4', glow: 'rgba(20,241,149,0.3)' },
            alpha:    { fill: '#FF9500', stroke: '#FFBA52', glow: 'rgba(255,149,0,0.4)' },
            sniper:   { fill: '#FF3B30', stroke: '#FF6B63', glow: 'rgba(255,59,48,0.4)' },
            cluster:  { fill: '#00D1FF', stroke: '#5CE0FF', glow: 'rgba(0,209,255,0.3)' },
            default:  { fill: '#555',    stroke: '#888',    glow: 'rgba(255,255,255,0.1)' },
        },
        EDGE_COLORS: {
            transfer:  'rgba(20,241,149,0.3)',
            trade:     'rgba(153,69,255,0.3)',
            cluster:   'rgba(0,209,255,0.3)',
            default:   'rgba(255,255,255,0.12)',
        },
        MIN_NODE_RADIUS: 12,
        MAX_NODE_RADIUS: 36,
        TOOLTIP_OFFSET: 15,
        // FIXED: Much calmer physics — nodes settle fast, stay on screen
        PHYSICS: {
            repulsion: 80,         // Reduced from 150
            attraction: 0.003,     // Reduced from 0.005
            damping: 0.82,         // More friction (was 0.92)
            centerGravity: 0.03,   // Stronger pull to center (was 0.01)
            maxVelocity: 2,        // Slower max speed (was 4)
            settleThreshold: 0.15, // Stop sim when energy below this
            padding: 40,           // Keep nodes this far from edges
        },
    };

    // ——— State ———
    let canvas = null, ctx = null, tooltip = null;
    let nodes = [], edges = [];
    let hoveredNode = null, dragNode = null;
    let mouseX = 0, mouseY = 0;
    let animId = null, settled = false, frameCount = 0;
    let isPanning = false;
    let panStart = { x: 0, y: 0 };
    let panOffset = { x: 0, y: 0 };
    let scale = 1;

    // ——— Init ———
    function init(canvasId, tooltipId) {
        canvas = document.getElementById(canvasId);
        tooltip = document.getElementById(tooltipId);
        if (!canvas) return;
        ctx = canvas.getContext('2d');
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        canvas.addEventListener('mousemove', onMouseMove);
        canvas.addEventListener('mousedown', onMouseDown);
        canvas.addEventListener('mouseup', onMouseUp);
        canvas.addEventListener('mouseleave', onMouseLeave);
        canvas.addEventListener('click', onClick);
        canvas.addEventListener('wheel', onWheel, { passive: false });
        canvas.addEventListener('dblclick', onDblClick);
        canvas.addEventListener('touchstart', onTouchStart, { passive: false });
        canvas.addEventListener('touchmove', onTouchMove, { passive: false });
        canvas.addEventListener('touchend', onTouchEnd);
    }

    function resizeCanvas() {
        if (!canvas) return;
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = Math.max(rect.height, 400);
    }

    // ——— Node/Edge Management ———
    function addNode(data) {
        const existing = nodes.find(n => n.id === data.id);
        if (existing) {
            Object.assign(existing, data, { x: existing.x, y: existing.y, vx: existing.vx, vy: existing.vy });
            return existing;
        }
        const w = canvas ? canvas.width : 600;
        const h = canvas ? canvas.height : 400;
        const pad = BMCONFIG.PHYSICS.padding;
        const node = {
            id: data.id,
            label: data.label || shortAddr(data.id),
            type: data.type || 'default',
            // Place in a circle around center — much more stable than random
            x: data.x || w / 2 + Math.cos(nodes.length * 2.4) * (80 + nodes.length * 8),
            y: data.y || h / 2 + Math.sin(nodes.length * 2.4) * (60 + nodes.length * 6),
            vx: 0, vy: 0,
            value: data.value || 1, radius: 0,
            address: data.address || data.id,
            symbol: data.symbol || null,
            marketCap: data.marketCap || 0,
            liquidity: data.liquidity || 0,
            volume: data.volume || 0,
            score: data.score || null,
            balance: data.balance || 0,
            txCount: data.txCount || 0,
            pnl: data.pnl || null,
            winRate: data.winRate || null,
            clusterId: data.clusterId || null,
            url: data.url || null,
            firstSeen: data.firstSeen || Date.now(),
            lastSeen: data.lastSeen || Date.now(),
            highlight: false, opacity: 1,
        };
        nodes.push(node);
        settled = false;
        computeRadii();
        return node;
    }

    function addEdge(data) {
        const key = `${data.source}|${data.target}`;
        const existing = edges.find(e => `${e.source}|${e.target}` === key || `${e.target}|${e.source}` === key);
        if (existing) { existing.weight = (existing.weight || 1) + (data.weight || 1); return existing; }
        edges.push({ source: data.source, target: data.target, type: data.type || 'default', weight: data.weight || 1, label: data.label || '', animated: data.animated || false });
        settled = false;
        return edges[edges.length - 1];
    }

    function clearAll() { nodes = []; edges = []; hoveredNode = null; dragNode = null; settled = false; }

    function computeRadii() {
        if (nodes.length === 0) return;
        const maxVal = Math.max(...nodes.map(n => n.value), 1);
        for (const n of nodes) {
            const ratio = n.value / maxVal;
            n.radius = BMCONFIG.MIN_NODE_RADIUS + (BMCONFIG.MAX_NODE_RADIUS - BMCONFIG.MIN_NODE_RADIUS) * Math.sqrt(ratio);
        }
    }

    function shortAddr(a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : '???'; }
    function formatVal(n) { if (!n || isNaN(n)) return '$0'; if (n >= 1e6) return `$${(n/1e6).toFixed(1)}M`; if (n >= 1e3) return `$${(n/1e3).toFixed(0)}K`; return `$${n.toFixed(0)}`; }

    // ——— FIXED: Stable Physics with Boundary Constraints ———
    function simulate() {
        if (settled || nodes.length === 0) return;
        const P = BMCONFIG.PHYSICS;
        const w = (canvas?.width || 600) / scale;
        const h = (canvas?.height || 400) / scale;
        const cx = w / 2;
        const cy = h / 2;
        let totalEnergy = 0;

        // Node-node repulsion
        for (let i = 0; i < nodes.length; i++) {
            const a = nodes[i];
            if (a === dragNode) continue;
            for (let j = i + 1; j < nodes.length; j++) {
                const b = nodes[j];
                if (b === dragNode) continue;
                let dx = a.x - b.x, dy = a.y - b.y;
                let dist = Math.sqrt(dx * dx + dy * dy) || 1;
                if (dist < (a.radius + b.radius + 30) * 2) {
                    const force = P.repulsion / (dist * dist);
                    a.vx += (dx / dist) * force;
                    a.vy += (dy / dist) * force;
                    b.vx -= (dx / dist) * force;
                    b.vy -= (dy / dist) * force;
                }
            }
            // Center gravity — keeps everything in view
            a.vx += (cx - a.x) * P.centerGravity;
            a.vy += (cy - a.y) * P.centerGravity;
        }

        // Edge attraction
        for (const edge of edges) {
            const a = nodes.find(n => n.id === edge.source);
            const b = nodes.find(n => n.id === edge.target);
            if (!a || !b || a === dragNode || b === dragNode) continue;
            const dx = b.x - a.x, dy = b.y - a.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = dist * P.attraction * (edge.weight || 1);
            a.vx += (dx / dist) * force; a.vy += (dy / dist) * force;
            b.vx -= (dx / dist) * force; b.vy -= (dy / dist) * force;
        }

        // Apply velocity + damping + BOUNDARY CLAMPING
        const pad = P.padding;
        for (const node of nodes) {
            if (node === dragNode) continue;
            node.vx = Math.max(-P.maxVelocity, Math.min(P.maxVelocity, node.vx * P.damping));
            node.vy = Math.max(-P.maxVelocity, Math.min(P.maxVelocity, node.vy * P.damping));
            node.x += node.vx;
            node.y += node.vy;
            // KEEP ON SCREEN — clamp to canvas bounds
            node.x = Math.max(pad + node.radius, Math.min(w - pad - node.radius, node.x));
            node.y = Math.max(pad + node.radius, Math.min(h - pad - node.radius, node.y));
            totalEnergy += Math.abs(node.vx) + Math.abs(node.vy);
        }

        // Auto-settle: stop simulating when nodes are barely moving
        frameCount++;
        if (frameCount > 120 && totalEnergy < P.settleThreshold * nodes.length) {
            settled = true;
        }
    }

    // ——— Rendering ———
    function draw() {
        if (!ctx || !canvas) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Empty state message
        if (nodes.length === 0) {
            drawEmptyState();
            return;
        }

        ctx.save();
        ctx.translate(panOffset.x, panOffset.y);
        ctx.scale(scale, scale);

        // Draw edges
        for (const edge of edges) {
            const a = nodes.find(n => n.id === edge.source);
            const b = nodes.find(n => n.id === edge.target);
            if (!a || !b) continue;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = BMCONFIG.EDGE_COLORS[edge.type] || BMCONFIG.EDGE_COLORS.default;
            ctx.lineWidth = Math.min(edge.weight * 0.5 + 0.5, 4);
            if (edge.animated) { ctx.setLineDash([6, 4]); ctx.lineDashOffset = -(Date.now() / 50) % 10; }
            else { ctx.setLineDash([]); }
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Draw nodes
        for (const node of nodes) {
            const colors = BMCONFIG.NODE_COLORS[node.type] || BMCONFIG.NODE_COLORS.default;
            const isHovered = node === hoveredNode;
            const r = node.radius * (isHovered ? 1.15 : 1);

            // Glow
            if (isHovered || node.highlight) { ctx.shadowColor = colors.glow; ctx.shadowBlur = isHovered ? 25 : 12; }

            // Fill
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
            ctx.fillStyle = colors.fill;
            ctx.globalAlpha = node.opacity;
            ctx.fill();

            // Stroke
            ctx.strokeStyle = isHovered ? '#fff' : colors.stroke;
            ctx.lineWidth = isHovered ? 2.5 : 1.5;
            ctx.stroke();
            ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.globalAlpha = 1;

            // Label inside node
            if (r > 10 || isHovered) {
                ctx.fillStyle = '#fff';
                ctx.font = `${isHovered ? 'bold ' : ''}${Math.max(9, r * 0.5)}px Inter`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                const label = node.symbol || node.label;
                ctx.fillText(label.length > 8 ? label.slice(0, 7) + '…' : label, node.x, node.y);
            }

            // Score badge
            if (node.score && node.score.total && r > 14) {
                const sr = Math.max(7, r * 0.3);
                ctx.beginPath();
                ctx.arc(node.x + r * 0.7, node.y - r * 0.7, sr, 0, Math.PI * 2);
                ctx.fillStyle = node.score.total >= 60 ? '#FF3B30' : node.score.total >= 45 ? '#FF9500' : '#555';
                ctx.fill();
                ctx.fillStyle = '#fff'; ctx.font = `bold ${sr * 1.1}px JetBrains Mono`;
                ctx.fillText(node.score.total, node.x + r * 0.7, node.y - r * 0.7);
            }
        }

        ctx.restore();
        drawOverlay();
    }

    function drawEmptyState() {
        const cx = canvas.width / 2, cy = canvas.height / 2;
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath(); ctx.arc(cx, cy, 50, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '13px Inter'; ctx.textAlign = 'center';
        ctx.fillText('No network data yet', cx, cy - 8);
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.font = '11px Inter';
        ctx.fillText('Start the Sniper Engine, then click "Refresh Map"', cx, cy + 12);
        ctx.fillText('Tokens appear as purple bubbles • Wallets as green', cx, cy + 28);
    }

    function drawOverlay() {
        // Top-left stats
        ctx.fillStyle = 'rgba(10,11,15,0.8)';
        const boxW = 200, boxH = 46;
        ctx.fillRect(8, 8, boxW, boxH);
        ctx.strokeStyle = 'rgba(153,69,255,0.3)'; ctx.lineWidth = 1;
        ctx.strokeRect(8, 8, boxW, boxH);
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px Inter'; ctx.textAlign = 'left';
        ctx.fillText(`Nodes: ${nodes.length}  |  Edges: ${edges.length}  |  Zoom: ${(scale*100).toFixed(0)}%`, 16, 24);
        ctx.fillStyle = settled ? 'rgba(20,241,149,0.5)' : 'rgba(255,149,0,0.5)';
        ctx.fillText(settled ? '● Settled — Hover/click nodes' : '○ Arranging nodes...', 16, 40);
    }

    // ——— Animation ———
    function startAnimation() {
        if (animId) return;
        settled = false; frameCount = 0;
        function loop() {
            simulate();
            draw();
            animId = requestAnimationFrame(loop);
        }
        loop();
    }

    function stopAnimation() { if (animId) { cancelAnimationFrame(animId); animId = null; } }

    // ——— Hit Testing ———
    function getNodeAt(mx, my) {
        const x = (mx - panOffset.x) / scale;
        const y = (my - panOffset.y) / scale;
        for (let i = nodes.length - 1; i >= 0; i--) {
            const n = nodes[i];
            const dx = x - n.x, dy = y - n.y;
            if (dx * dx + dy * dy <= n.radius * n.radius * 1.3) return n;
        }
        return null;
    }

    // ——— Tooltip ———
    function showTooltip(node, x, y) {
        if (!tooltip) return;
        const typeLabels = { token: '🪙 Token', wallet: '👛 Wallet', alpha: '⭐ Alpha', sniper: '🎯 Sniper', cluster: '🔗 Cluster' };
        let html = `<div class="bm-tooltip-header"><span class="bm-tooltip-type bm-type-${node.type}">${typeLabels[node.type] || '📍'}</span><span class="bm-tooltip-name">${node.symbol || node.label}</span></div>`;
        html += `<div class="bm-tooltip-addr">${node.address}</div><div class="bm-tooltip-metrics">`;
        if (node.type === 'token') {
            if (node.marketCap) html += `<div class="bm-tooltip-metric"><span>MCap</span><span>${formatVal(node.marketCap)}</span></div>`;
            if (node.liquidity) html += `<div class="bm-tooltip-metric"><span>Liquidity</span><span>${formatVal(node.liquidity)}</span></div>`;
            if (node.volume) html += `<div class="bm-tooltip-metric"><span>Volume</span><span>${formatVal(node.volume)}</span></div>`;
            if (node.score) html += `<div class="bm-tooltip-metric"><span>Score</span><span class="bm-score-${node.score.total >= 60 ? 'high' : node.score.total >= 40 ? 'mid' : 'low'}">${node.score.total}/100 ${node.score.grade || ''}</span></div>`;
        } else {
            if (node.txCount) html += `<div class="bm-tooltip-metric"><span>Txns</span><span>${node.txCount}</span></div>`;
            if (node.pnl != null) html += `<div class="bm-tooltip-metric"><span>PnL</span><span class="${node.pnl >= 0 ? 'bm-positive' : 'bm-negative'}">${node.pnl >= 0 ? '+' : ''}${node.pnl.toFixed(2)} SOL</span></div>`;
            if (node.winRate != null) html += `<div class="bm-tooltip-metric"><span>Win Rate</span><span>${node.winRate.toFixed(0)}%</span></div>`;
            if (node.clusterId) html += `<div class="bm-tooltip-metric"><span>Cluster</span><span>#${node.clusterId}</span></div>`;
        }
        html += `</div><div class="bm-tooltip-hint">🔗 Click → Solscan  |  Dbl-click → Zoom</div>`;
        tooltip.innerHTML = html;
        tooltip.style.display = 'block';
        const rect = canvas.getBoundingClientRect();
        let tx = x + BMCONFIG.TOOLTIP_OFFSET, ty = y + BMCONFIG.TOOLTIP_OFFSET;
        if (tx + 240 > rect.width) tx = x - 250;
        if (ty + 180 > rect.height) ty = y - 190;
        tooltip.style.left = Math.max(0, tx) + 'px';
        tooltip.style.top = Math.max(0, ty) + 'px';
    }
    function hideTooltip() { if (tooltip) tooltip.style.display = 'none'; }

    // ——— Events ———
    function onMouseMove(e) {
        const rect = canvas.getBoundingClientRect();
        mouseX = e.clientX - rect.left; mouseY = e.clientY - rect.top;
        if (dragNode) { dragNode.x = (mouseX - panOffset.x) / scale; dragNode.y = (mouseY - panOffset.y) / scale; dragNode.vx = 0; dragNode.vy = 0; settled = false; return; }
        if (isPanning) { panOffset.x = mouseX - panStart.x; panOffset.y = mouseY - panStart.y; return; }
        const node = getNodeAt(mouseX, mouseY);
        if (node !== hoveredNode) { hoveredNode = node; canvas.style.cursor = node ? 'pointer' : 'grab'; node ? showTooltip(node, mouseX, mouseY) : hideTooltip(); }
        else if (node) showTooltip(node, mouseX, mouseY);
    }
    function onMouseDown(e) {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const node = getNodeAt(mx, my);
        if (node) { dragNode = node; canvas.style.cursor = 'grabbing'; }
        else { isPanning = true; panStart.x = mx - panOffset.x; panStart.y = my - panOffset.y; canvas.style.cursor = 'grabbing'; }
    }
    function onMouseUp() { dragNode = null; isPanning = false; canvas.style.cursor = hoveredNode ? 'pointer' : 'grab'; }
    function onMouseLeave() { hideTooltip(); hoveredNode = null; dragNode = null; isPanning = false; canvas.style.cursor = 'grab'; }

    function onClick(e) {
        const rect = canvas.getBoundingClientRect();
        const node = getNodeAt(e.clientX - rect.left, e.clientY - rect.top);
        if (node) {
            const url = node.type === 'token'
                ? BMCONFIG.SOLSCAN_URL + 'token/' + node.address
                : BMCONFIG.SOLSCAN_URL + 'account/' + node.address;
            window.open(url, '_blank');
        }
    }

    function onDblClick(e) {
        const rect = canvas.getBoundingClientRect();
        const node = getNodeAt(e.clientX - rect.left, e.clientY - rect.top);
        if (node) {
            scale = Math.min(scale * 1.5, 3);
            panOffset.x = canvas.width / 2 - node.x * scale;
            panOffset.y = canvas.height / 2 - node.y * scale;
        }
    }

    function onWheel(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.max(0.3, Math.min(3, scale * delta));
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        panOffset.x = mx - (mx - panOffset.x) * (newScale / scale);
        panOffset.y = my - (my - panOffset.y) * (newScale / scale);
        scale = newScale;
    }

    function onTouchStart(e) { e.preventDefault(); if (e.touches.length === 1) { const t = e.touches[0]; const rect = canvas.getBoundingClientRect(); const mx = t.clientX - rect.left, my = t.clientY - rect.top; const node = getNodeAt(mx, my); if (node) { dragNode = node; showTooltip(node, mx, my); } else { isPanning = true; panStart.x = mx - panOffset.x; panStart.y = my - panOffset.y; } } }
    function onTouchMove(e) { e.preventDefault(); if (e.touches.length === 1) { const t = e.touches[0]; const rect = canvas.getBoundingClientRect(); const mx = t.clientX - rect.left, my = t.clientY - rect.top; if (dragNode) { dragNode.x = (mx - panOffset.x) / scale; dragNode.y = (my - panOffset.y) / scale; settled = false; } else if (isPanning) { panOffset.x = mx - panStart.x; panOffset.y = my - panStart.y; } } }
    function onTouchEnd() { dragNode = null; isPanning = false; hideTooltip(); }

    // ——— Data Loaders ———
    function loadFromSniperEngine() {
        if (typeof SniperEngine === 'undefined') return;
        const s = SniperEngine.getState();
        for (const token of s.tokens) {
            addNode({ id: token.address, address: token.address, label: token.symbol, symbol: token.symbol, type: 'token',
                value: Math.max(1, (token.score?.total || 0) / 10), marketCap: token.marketCap, liquidity: token.liquidity,
                volume: token.volume24h || token.volume1h, score: token.score, url: token.url });
        }
    }

    function loadFromClusterIntel() {
        if (typeof ClusterIntel === 'undefined') return;
        const s = ClusterIntel.state;
        if (s.nodes) { for (const [addr, data] of s.nodes) { const firstLabel = data.labels instanceof Set ? data.labels.values().next().value : (Array.isArray(data.labels) ? data.labels[0] : null); const isAlpha = data.labels instanceof Set ? data.labels.has('alpha') : (Array.isArray(data.labels) ? data.labels.includes('alpha') : false); addNode({ id: addr, address: addr, label: firstLabel || shortAddr(addr), type: isAlpha ? 'alpha' : 'wallet', value: Math.max(1, data.txCount || 1), txCount: data.txCount, volume: data.volume, clusterId: data.clusterId }); } }
        if (s.edges) { for (const [key, data] of s.edges) { addEdge({ source: data.from, target: data.to, type: data.type || 'transfer', weight: data.count || 1 }); } }
    }

    function loadFromPaperTrader() {
        if (typeof PaperTrader === 'undefined') return;
        const m = PaperTrader.getMetrics();
        for (const pos of m.positions) { addNode({ id: pos.tokenAddress, address: pos.tokenAddress, label: pos.tokenSymbol, symbol: pos.tokenSymbol, type: 'sniper', value: Math.max(1, pos.positionSize), pnl: pos.pnlSol, marketCap: pos.marketCap, liquidity: pos.liquidityUsd }); }
    }

    function loadFromDB() {
        if (typeof ScannerDB === 'undefined') return;
        ScannerDB.getAllTokens().then(tokens => { for (const t of tokens.slice(0, 80)) { addNode({ id: t.address, address: t.address, label: t.symbol || shortAddr(t.address), symbol: t.symbol, type: 'token', value: Math.max(1, (t.score?.total || 0) / 10), marketCap: t.marketCap, liquidity: t.liquidity, score: t.score }); } }).catch(() => {});
        ScannerDB.getAllWallets().then(wallets => { for (const w of wallets.slice(0, 80)) { addNode({ id: w.address, address: w.address, label: shortAddr(w.address), type: w.isAlpha ? 'alpha' : 'wallet', value: Math.max(1, w.txCount || 1), txCount: w.txCount, pnl: w.pnlScore, winRate: w.winRate, clusterId: w.clusterId }); } }).catch(() => {});
    }

    function refreshAll() { clearAll(); loadFromSniperEngine(); loadFromClusterIntel(); loadFromPaperTrader(); loadFromDB(); computeRadii(); settled = false; frameCount = 0; }

    return {
        init, addNode, addEdge, clearAll, refreshAll, startAnimation, stopAnimation,
        loadFromSniperEngine, loadFromClusterIntel, loadFromPaperTrader, loadFromDB,
        get nodeCount() { return nodes.length; }, get edgeCount() { return edges.length; },
    };
})();
