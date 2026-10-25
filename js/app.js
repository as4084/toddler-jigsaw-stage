(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const canvas = $("gameCanvas");
  const ctx = canvas.getContext("2d");
  const imageInput = $("imageInput");
  const previewImage = $("previewImage");
  const previewPlaceholder = $("previewPlaceholder");
  const imageStatus = $("imageStatus");
  const startButton = $("startButton");
  const gameSection = $("gameSection");
  const parentSettings = $("parentSettings");
  const settingsToggle = $("settingsToggle");
  const settingsDone = $("settingsDone");
  const rotationCheckbox = $("rotationEnabled");
  const guideModeInputs = [...document.querySelectorAll('input[name="guideMode"]')];
  const completion = $("completion");

  const STORAGE_KEY = "toddler-jigsaw-settings-v1";
  const W = canvas.width, H = canvas.height;
  let selectedImage = null;
  let pieces = [];
  let board = { x: 30, y: 28, w: 900, h: 600, cellW: 450, cellH: 300, cols: 2, rows: 2 };
  let selectedPiece = null;
  let dragging = null;
  let guideVisible = true;
  let soundContext = null;
  let moves = 0;

  const saved = readSettings();
  document.querySelector(`input[name="pieceCount"][value="${saved.count}"]`).checked = true;
  rotationCheckbox.checked = saved.rotation;
  document.querySelector(`input[name="guideMode"][value="${saved.guideMode}"]`).checked = true;

  function readSettings() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      // Migrate the previous boolean setting to the new three-state option.
      const legacyGuideMode = data.showGuide === false ? "never" : "first";
      const guideMode = ["always", "first", "never"].includes(data.guideMode) ? data.guideMode : legacyGuideMode;
      return { count: [4, 9, 16].includes(data.count) ? data.count : 4, rotation: !!data.rotation, guideMode };
    } catch { return { count: 4, rotation: false, guideMode: "always" }; }
  }
  function saveSettings() {
    const count = Number(document.querySelector('input[name="pieceCount"]:checked').value);
    const guideMode = document.querySelector('input[name="guideMode"]:checked').value;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ count, rotation: rotationCheckbox.checked, guideMode }));
  }
  function currentSettings() {
    return { count: Number(document.querySelector('input[name="pieceCount"]:checked').value), rotation: rotationCheckbox.checked, guideMode: document.querySelector('input[name="guideMode"]:checked').value };
  }

  settingsToggle.addEventListener("click", () => {
    parentSettings.hidden = !parentSettings.hidden;
    settingsToggle.setAttribute("aria-expanded", String(!parentSettings.hidden));
  });
  settingsDone.addEventListener("click", () => {
    parentSettings.hidden = true;
    settingsToggle.setAttribute("aria-expanded", "false");
    saveSettings();
  });
  document.querySelectorAll('input[name="pieceCount"]').forEach(el => el.addEventListener("change", saveSettings));
  rotationCheckbox.addEventListener("change", saveSettings);
  guideModeInputs.forEach(el => el.addEventListener("change", saveSettings));

  imageInput.addEventListener("change", async () => {
    const file = imageInput.files && imageInput.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      imageStatus.textContent = "画像ファイルをえらんでね。";
      return;
    }
    try {
      // createImageBitmap normally respects the image's EXIF orientation in modern browsers.
      if (selectedImage && selectedImage.close) selectedImage.close();
      selectedImage = await createImageBitmap(file, { imageOrientation: "from-image" });
      previewImage.src = URL.createObjectURL(file);
      previewImage.hidden = false;
      previewPlaceholder.hidden = true;
      imageStatus.textContent = `${selectedImage.width} × ${selectedImage.height} の画像をえらんだよ。`;
      startButton.disabled = false;
    } catch (error) {
      imageStatus.textContent = "この画像は読みこめなかったよ。別の画像をためしてね。";
      console.error(error);
    }
  });

  startButton.addEventListener("click", startGame);
  $("restartButton").addEventListener("click", startGame);
  $("playAgain").addEventListener("click", startGame);
  $("backToSetup").addEventListener("click", returnToSetup);
  $("rotateLeft").addEventListener("click", () => rotateSelected(-1));
  $("rotateRight").addEventListener("click", () => rotateSelected(1));

  function startGame() {
    if (!selectedImage) return;
    saveSettings();
    const settings = currentSettings();
    const cols = Math.sqrt(settings.count), rows = cols;
    // Use most of the canvas for the picture while preserving its aspect ratio.
    const aspect = selectedImage.width / selectedImage.height;
    const maxW = W - 24, maxH = 900;
    let bw = maxW, bh = bw / aspect;
    if (bh > maxH) { bh = maxH; bw = bh * aspect; }
    board = { x: (W - bw) / 2, y: 28, w: bw, h: bh, cols, rows, cellW: bw / cols, cellH: bh / rows };
    pieces = [];
    const tabs = makeTabs(cols, rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const correctX = board.x + c * board.cellW;
        const correctY = board.y + r * board.cellH;
        const p = {
          id: r * cols + c, row: r, col: c, correctX, correctY,
          x: 0, y: 0, rotation: 0, solved: false, scale: 1,
          edges: tabs[r][c], w: board.cellW, h: board.cellH
        };
        pieces.push(p);
      }
    }
    // Shuffle pieces, then randomly rotate roughly half when rotation mode is enabled.
    for (let i = pieces.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
    }
    if (settings.rotation) {
      const rotateCount = Math.max(1, Math.floor(settings.count / 2));
      const candidates = [...pieces];
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }
      candidates.slice(0, rotateCount).forEach(p => {
        p.rotation = [90, 180, 270][Math.floor(Math.random() * 3)];
      });
    }
    layoutTray();
    selectedPiece = null; dragging = null; guideVisible = settings.guideMode !== "never"; moves = 0;
    completion.hidden = true;
    // Switch to a focused puzzle-only screen after starting.
    document.body.classList.add("playing");
    document.querySelector(".setup").hidden = true;
    parentSettings.hidden = true;
    settingsToggle.setAttribute("aria-expanded", "false");
    gameSection.hidden = false;
    $("gameTitle").textContent = `${settings.count}ピースのパズル`;
    $("gameHint").textContent = settings.rotation
      ? "ピースをえらんで、場所をタップ！ 回転ボタンで向きをかえられるよ。"
      : "ピースをえらんで、入れる場所をタップしてね。";
    $("rotateLeft").hidden = $("rotateRight").hidden = !settings.rotation;
    $("rotateLeft").disabled = $("rotateRight").disabled = true;
    gameSection.scrollIntoView({ behavior: "smooth", block: "start" });
    draw();
  }

  function returnToSetup() {
    document.body.classList.remove("playing");
    gameSection.hidden = true;
    document.querySelector(".setup").hidden = false;
    parentSettings.hidden = true;
    settingsToggle.setAttribute("aria-expanded", "false");
    completion.hidden = true;
    selectedPiece = null;
    dragging = null;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function makeTabs(cols, rows) {
    // Each interior edge gets one shared sign: neighboring pieces receive complementary tabs.
    const vertical = Array.from({length: rows}, () => Array(cols + 1).fill(0));
    const horizontal = Array.from({length: rows + 1}, () => Array(cols).fill(0));
    for (let r = 0; r < rows; r++) for (let c = 1; c < cols; c++) vertical[r][c] = Math.random() < .5 ? 1 : -1;
    for (let r = 1; r < rows; r++) for (let c = 0; c < cols; c++) horizontal[r][c] = Math.random() < .5 ? 1 : -1;
    return Array.from({length: rows}, (_, r) => Array.from({length: cols}, (_, c) => ({
      top: r === 0 ? 0 : -horizontal[r][c],
      right: c === cols - 1 ? 0 : vertical[r][c + 1],
      bottom: r === rows - 1 ? 0 : horizontal[r + 1][c],
      left: c === 0 ? 0 : -vertical[r][c]
    })));
  }

  function layoutTray() {
    const n = pieces.length;
    const cols = n <= 4 ? 4 : n <= 9 ? 5 : 6;
    const gap = 10, margin = 18, trayTop = board.y + board.h + 78;
    const rows = Math.ceil(n / cols);
    const availW = (W - margin * 2 - gap * (cols - 1)) / cols;
    const availH = Math.max(52, (H - trayTop - 28 - gap * (rows - 1)) / rows);
    const scale = Math.max(.22, Math.min(.78, availW / board.cellW, availH / board.cellH));
    const cw = board.cellW * scale, ch = board.cellH * scale;
    const totalW = cols * cw + (cols - 1) * gap;
    const startX = (W - totalW) / 2;
    pieces.forEach((p, i) => {
      if (p.solved) { p.scale = 1; return; }
      const slot = i % cols, row = Math.floor(i / cols);
      p.scale = dragging && dragging.piece === p ? 1 : scale;
      p.x = startX + slot * (cw + gap) + (cw - cw) / 2;
      p.y = trayTop + row * (ch + gap) + 4;
    });
  }

  function tracePiecePath(c, w, h, edges, scale = 1) {
    const tab = Math.min(w, h) * .19;
    const neck = Math.min(w, h) * .105;
    const mid = .5;
    c.beginPath();
    c.moveTo(0, 0);
    edgePath(c, "h", 0, 0, w, edges.top, tab, neck, true);
    edgePath(c, "v", w, 0, h, edges.right, tab, neck, true);
    edgePath(c, "h", w, h, -w, edges.bottom, tab, neck, false);
    edgePath(c, "v", 0, h, -h, edges.left, tab, neck, false);
    c.closePath();
  }
  function edgePath(c, axis, x, y, length, sign, tab, neck, forward) {
    if (!sign) {
      if (axis === "h") c.lineTo(x + length, y); else c.lineTo(x, y + length);
      return;
    }
    const dir = Math.sign(length), L = Math.abs(length);
    const point = (t, offset) => axis === "h"
      ? [x + dir * t, y + offset]
      : [x + offset, y + dir * t];
    const outward = axis === "h" ? (forward ? -1 : 1) : (forward ? 1 : -1);
    // Tab direction is defined in the piece's local coordinates.
    const s = sign * outward;
    const p0 = point(L * .34, 0), p1 = point(L * .40, 0), p2 = point(L * .43, s * neck);
    const p3 = point(L * .44, s * tab), p4 = point(L * .56, s * tab);
    const p5 = point(L * .57, s * neck), p6 = point(L * .60, 0), p7 = point(L * .66, 0);
    c.lineTo(...p0); c.lineTo(...p1);
    c.bezierCurveTo(...point(L*.42,0), ...p2, ...p3);
    c.bezierCurveTo(...point(L*.46,s*tab), ...point(L*.54,s*tab), ...p4);
    c.bezierCurveTo(...point(L*.58,s*tab), ...p5, ...p6);
    c.lineTo(...p7);
    if (axis === "h") c.lineTo(x + length, y); else c.lineTo(x, y + length);
  }

  function drawPiece(p, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const scale = p.solved ? 1 : (p.scale || 1);
    const cx = p.x + p.w * scale / 2, cy = p.y + p.h * scale / 2;
    ctx.translate(cx, cy);
    ctx.rotate(p.rotation * Math.PI / 180);
    ctx.scale(scale, scale);
    ctx.translate(-p.w / 2, -p.h / 2);
    ctx.save();
    tracePiecePath(ctx, p.w, p.h, p.edges);
    ctx.clip();
    // Paint the full source image shifted so this piece shows its own original region.
    ctx.drawImage(selectedImage, -p.col * p.w, -p.row * p.h, board.w, board.h);
    ctx.restore();
    ctx.save();
    tracePiecePath(ctx, p.w, p.h, p.edges);
    ctx.lineWidth = 4;
    ctx.strokeStyle = p === selectedPiece ? "#f06d83" : "#ffffff";
    ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(70,60,55,.28)"; ctx.stroke();
    ctx.restore();
    if (p === selectedPiece && !p.solved) {
      ctx.strokeStyle = "#f06d83"; ctx.lineWidth = 5;
      ctx.strokeRect(-2, -2, p.w + 4, p.h + 4);
    }
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#fffaf1"; ctx.fillRect(0, 0, W, H);
    // Board shadow and outline.
    ctx.save();
    ctx.fillStyle = "#f1e7d6"; roundRect(ctx, board.x - 5, board.y - 5, board.w + 10, board.h + 10, 18); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillRect(board.x, board.y, board.w, board.h);
    if (guideVisible) {
      ctx.save(); ctx.globalAlpha = .28;
      ctx.drawImage(selectedImage, board.x, board.y, board.w, board.h);
      ctx.restore();
    }
    ctx.strokeStyle = "#d8cbb7"; ctx.lineWidth = 2;
    for (let c = 1; c < board.cols; c++) {
      ctx.beginPath(); ctx.moveTo(board.x + c * board.cellW, board.y); ctx.lineTo(board.x + c * board.cellW, board.y + board.h); ctx.stroke();
    }
    for (let r = 1; r < board.rows; r++) {
      ctx.beginPath(); ctx.moveTo(board.x, board.y + r * board.cellH); ctx.lineTo(board.x + board.w, board.y + r * board.cellH); ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = "#8c8378"; ctx.font = "bold 22px sans-serif"; ctx.textAlign = "left";
    ctx.fillText("ピースを ここからえらんでね", 26, Math.min(H - 15, board.y + board.h + 42));
    // Solved pieces stay locked on the board.
    pieces.filter(p => p.solved).forEach(p => drawPiece(p));
    pieces.filter(p => !p.solved && p !== dragging?.piece).forEach(p => drawPiece(p));
    if (dragging) drawPiece(dragging.piece, .95);
    if (selectedPiece && !selectedPiece.solved) {
      ctx.fillStyle = "#f06d83"; ctx.font = "bold 18px sans-serif";
      ctx.fillText("えらんだピース", 26, H - 14);
    }
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r);
    c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath();
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * W / rect.width, y: (event.clientY - rect.top) * H / rect.height };
  }
  function hitPiece(point) {
    // Reverse draw order so the visually topmost piece gets selected.
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i];
      if (p.solved) continue;
      const scale = p.scale || 1;
      if (point.x >= p.x - 8 && point.x <= p.x + p.w * scale + 8 && point.y >= p.y - 8 && point.y <= p.y + p.h * scale + 8) return p;
    }
    return null;
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (gameSection.hidden || completion.hidden === false) return;
    const point = canvasPoint(event);
    const p = hitPiece(point);
    if (p) {
      selectedPiece = p;
      const oldScale = p.scale || 1;
      dragging = { piece: p, dx: (point.x - p.x) / oldScale, dy: (point.y - p.y) / oldScale, moved: false, startX: point.x, startY: point.y, oldScale };
      p.scale = 1;
      canvas.setPointerCapture(event.pointerId);
      updateRotateButtons(); draw();
    } else {
      // Tap an empty board cell to place the currently selected piece.
      if (selectedPiece && pointInBoard(point)) tryPlace(selectedPiece, point);
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const point = canvasPoint(event);
    if (Math.hypot(point.x - dragging.startX, point.y - dragging.startY) > 8) dragging.moved = true;
    if (dragging.moved) {
      dragging.piece.x = point.x - dragging.dx;
      dragging.piece.y = point.y - dragging.dy;
      draw();
    }
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!dragging) return;
    const point = canvasPoint(event);
    const p = dragging.piece;
    const moved = dragging.moved;
    dragging = null;
    if (moved) {
      // Drop near the target cell to snap; otherwise leave the piece where dropped.
      tryPlace(p, { x: point.x, y: point.y });
    } else {
      selectedPiece = p;
      p.scale = 1;
      // A selected piece grows to full size; its tray position is retained until moved.
    }
    updateRotateButtons(); draw();
  });
  canvas.addEventListener("pointercancel", () => { dragging = null; draw(); });

  function pointInBoard(p) { return p.x >= board.x && p.x <= board.x + board.w && p.y >= board.y && p.y <= board.y + board.h; }
  function tryPlace(p, point) {
    if (!p || p.solved) return;
    const targetCx = p.correctX + p.w / 2, targetCy = p.correctY + p.h / 2;
    const dropCx = point.x, dropCy = point.y;
    // When dragging, the release point should be inside the correct cell; tapping selects the destination.
    const col = Math.floor((dropCx - board.x) / board.cellW);
    const row = Math.floor((dropCy - board.y) / board.cellH);
    const inBoard = pointInBoard(point);
    if (inBoard && col === p.col && row === p.row && p.rotation % 360 === 0) {
      p.x = p.correctX; p.y = p.correctY; p.solved = true; selectedPiece = null;
      if (currentSettings().guideMode === "first") guideVisible = false;
      moves++; playCorrectSound(); animateSuccess(p);
      if (pieces.every(piece => piece.solved)) {
        setTimeout(() => { completion.hidden = false; playCelebration(); }, 300);
      }
    } else {
      // A drop on the wrong cell gently returns to the tray. If dropped outside the board, keep it there.
      if (inBoard) { layoutTray(); }
    }
    updateRotateButtons(); draw();
  }

  function rotateSelected(step) {
    if (!selectedPiece || selectedPiece.solved || !currentSettings().rotation) return;
    selectedPiece.rotation = (selectedPiece.rotation + step * 90 + 360) % 360;
    updateRotateButtons(); draw();
  }
  function updateRotateButtons() {
    const enabled = currentSettings().rotation && !!selectedPiece && !selectedPiece.solved;
    $("rotateLeft").disabled = !enabled;
    $("rotateRight").disabled = !enabled;
  }

  function playTone(freq, duration, type = "sine", volume = .08) {
    try {
      soundContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (soundContext.state === "suspended") soundContext.resume();
      const osc = soundContext.createOscillator(), gain = soundContext.createGain();
      osc.type = type; osc.frequency.value = freq; gain.gain.value = volume;
      osc.connect(gain); gain.connect(soundContext.destination);
      osc.start(); gain.gain.exponentialRampToValueAtTime(.001, soundContext.currentTime + duration);
      osc.stop(soundContext.currentTime + duration);
    } catch (_) { /* Sound is optional if the browser blocks audio. */ }
  }
  function playCorrectSound() { playTone(660, .12); setTimeout(() => playTone(880, .18), 90); }
  function playCelebration() { [523, 659, 784, 1047].forEach((n, i) => setTimeout(() => playTone(n, .22), i * 110)); }
  function animateSuccess(p) {
    // Lightweight pop animation using the Web Animations API where available.
    if (canvas.animate) {
      canvas.animate([{ transform: "scale(1)" }, { transform: "scale(1.006)" }, { transform: "scale(1)" }], { duration: 220 });
    }
  }
})();
