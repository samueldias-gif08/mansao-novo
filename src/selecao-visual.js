"use strict";

const AMBIENTES_SELECT = {
  p1: ["#d5a578", "faísca", "Projétil em arco"],
  p2: ["#a8c75c", "faísca", "Recuo evasivo"],
  p3: ["#86b7e3", "faísca", "Investidas e contra-ataques"],
  serena: ["#97db77", "folha", "Chutes encadeados"],
  android67: ["#b4ecff", "pulso", "Combos de boxe e laser"],
  belyx: ["#bc79f5", "faísca", "Teleporte e defesa sombria"],
  alessander: ["#c1a0f5", "onda", "Tornado e ondas sônicas"],
  carter: ["#f3cb7a", "folha", "Combate aéreo"],
  greeg: ["#a4e66c", "onda", "Defesa e agarrões"],
  morgana: ["#ef557d", "raio", "Agarrões e poderes sobrenaturais"],
};

class SelecaoVisual {
  desenhar(jogo, ctx, agora) {
    const S = jogo.select;
    const confronto = S.saindo > 0 ? Math.min(1, (0.85 - S.saindo) / 0.48) : 0;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    this._fundo(ctx, agora);
    this._jogador(jogo, ctx, "p1", agora, confronto);
    this._jogador(jogo, ctx, "p2", agora, confronto);
    this._centro(jogo, ctx, confronto);
    this._grade(jogo, ctx);

    ctx.textAlign = "center";
    ctx.font = "12px 'Segoe UI', sans-serif";
    ctx.fillStyle = "#b8bbc9";
    const controles = jogo.modo === "2p" ? "P1  WASD + F     ·     P2  Setas + J"
      : "WASD + F / ENTER  ·  Escolha seu lutador e o da CPU";
    ctx.fillText(`${controles}     ·     Clique para escolher     ·     ESC volta`, LARGURA / 2, 530);

    for (const p of S.particulas) {
      ctx.globalAlpha = Math.max(0, p.vida / p.vidaMax) * 0.68;
      ctx.fillStyle = p.cor;
      ctx.fillRect(p.x, p.y, p.raio * 2, p.raio);
    }
    ctx.globalAlpha = 1;
    if (S.intro > 0) {
      ctx.fillStyle = `rgba(4,6,12,${Math.min(0.58, S.intro * 0.8)})`;
      ctx.fillRect(0, 0, LARGURA, ALTURA);
    }
    ctx.restore();
  }

  _pintarBase(ctx) {
    const base = ctx.createLinearGradient(0, 0, LARGURA, 380);
    base.addColorStop(0, "#270b19");
    base.addColorStop(0.46, "#11141f");
    base.addColorStop(0.55, "#11141f");
    base.addColorStop(1, "#0b2244");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, LARGURA, ALTURA);
    for (const [x, cor] of [[169, "#98334859"], [480, "#d7c6a32c"], [793, "#4188df68"]]) {
      const luz = ctx.createRadialGradient(x, 122, 18, x, 140, 310);
      luz.addColorStop(0, cor);
      luz.addColorStop(1, "#10121c00");
      ctx.fillStyle = luz;
      ctx.fillRect(0, 0, LARGURA, 401);
    }
    const piso = ctx.createLinearGradient(0, 301, 0, 405);
    piso.addColorStop(0, "#0b0c1300");
    piso.addColorStop(1, "#080a0f");
    ctx.fillStyle = piso;
    ctx.fillRect(0, 301, LARGURA, 239);
    ctx.save();
    ctx.globalAlpha = 0.2;
    for (let i = 0; i < 9; i++) {
      const x = 25 + i * 115;
      const facho = ctx.createLinearGradient(x, 0, x + 45, 340);
      facho.addColorStop(0, i < 4 ? "#c66e85" : "#84a5d3");
      facho.addColorStop(1, "#69728a00");
      ctx.fillStyle = facho;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 13, 0);
      ctx.lineTo(x + 90, 383);
      ctx.lineTo(x - 57, 383);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  _fundo(ctx, agora) {
    if (!this.fundoBase) {
      this.fundoBase = document.createElement("canvas");
      this.fundoBase.width = LARGURA;
      this.fundoBase.height = ALTURA;
      this._pintarBase(this.fundoBase.getContext("2d"));
    }
    ctx.drawImage(this.fundoBase, 0, 0);
    ctx.save();
    for (let i = 0; i < 26; i++) {
      const x = (i * 137 + agora * (0.006 + i % 4 * 0.003)) % LARGURA;
      const y = (i * 59 + 390 - (agora * 0.009) % 390) % 390;
      ctx.fillStyle = i % 2 ? "#fa9b9e" : "#b3d8ff";
      const r = 1 + i % 4;
      ctx.globalAlpha = 0.12 + (i % 5) * 0.05;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _ambiente(ctx, pers, esquerda, agora) {
    if (!pers || !AMBIENTES_SELECT[pers]) return;
    const [cor, tipo] = AMBIENTES_SELECT[pers];
    const origem = esquerda ? 228 : 732;
    ctx.save();
    ctx.fillStyle = cor;
    ctx.strokeStyle = cor;
    for (let i = 0; i < 13; i++) {
      const x = origem + Math.sin(i * 2.15 + agora * 0.0006) * (119 + i % 4 * 15);
      const y = 309 - (i * 41 + agora * (0.017 + i % 2 * 0.007)) % 255;
      ctx.globalAlpha = 0.13 + (i % 3) * 0.11;
      ctx.beginPath();
      if (tipo === "folha") {
        ctx.ellipse(x, y, 6, 2.15, i + agora * 0.001, 0, Math.PI * 2);
        ctx.fill();
      } else if (tipo === "onda" || tipo === "pulso") {
        ctx.ellipse(x, y, 7 + i % 4, 2.2, -0.4, 0, Math.PI * 2);
        ctx.stroke();
      } else if (tipo === "raio" && i % 3 === 0) {
        ctx.moveTo(x - 4, y - 6);
        ctx.lineTo(x + 1, y - 1);
        ctx.lineTo(x - 2, y + 1);
        ctx.lineTo(x + 4, y + 8);
        ctx.stroke();
      } else {
        ctx.fillRect(x, y, 2 + i % 3, 2);
      }
    }
    ctx.restore();
  }

  _arte(jogo, ctx, cel, esquerda, agora, alfa, deslize, confronto, flash) {
    if (alfa <= 0) return;
    const pers = cel.pers;
    const arte = jogo.recursos.artesSelecao?.[pers]?.principal;
    const img = arte || jogo.recursos.retrato(pers);
    const lado = esquerda ? 1 : -1;
    const centro = (esquerda ? 242 : 718) + lado * (confronto * 13 - deslize);
    ctx.save();
    ctx.globalAlpha = alfa;
    if (!img) {
      ctx.textAlign = "center";
      ctx.font = "italic 900 168px 'Arial Black', sans-serif";
      ctx.fillStyle = SELECT_TEMA.ouro;
      ctx.globalAlpha *= 0.54;
      ctx.fillText("?", centro, 251);
      ctx.restore();
      return;
    }
    const voo = pers === "carter";
    const y = voo ? Math.sin(agora * 0.0037) * 8 : Math.sin(agora * 0.0018) * 2;
    const escala = Math.min(455 / img.width, (voo ? 302 : 326) / img.height)
      * (1 + confronto * 0.063 + flash * 0.045);
    const w = img.width * escala, h = img.height * escala;
    ctx.translate(centro, y - Math.sin(flash * Math.PI * 2) * 5);
    if (!esquerda) ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, (voo ? 332 : 354) - h, w, h);
    ctx.restore();
  }

  _jogador(jogo, ctx, slot, agora, confronto) {
    const S = jogo.select;
    const esquerda = slot === "p1";
    const tema = SELECT_TEMA[slot];
    const cel = SELECT_CELULAS[S.cursor[slot]];
    const t = 1 - (1 - S.trans[slot]) ** 3;
    const flash = S.flash[slot];
    const x = esquerda ? 24 : LARGURA - 24;
    const confirmado = jogo.confirmado[slot];
    ctx.save();
    ctx.beginPath();
    ctx.rect(esquerda ? 0 : LARGURA / 2, 0, LARGURA / 2, 386);
    ctx.clip();
    this._ambiente(ctx, cel.pers, esquerda, agora);
    if (t < 1) this._arte(jogo, ctx, SELECT_CELULAS[S.prevCursor[slot]], esquerda, agora, 1 - t, -13 * t, 0, 0);
    this._arte(jogo, ctx, cel, esquerda, agora, t, 36 * (1 - t), confronto, flash);
    if (flash > 0 || confronto > 0) {
      const brilho = ctx.createRadialGradient(x + (esquerda ? 210 : -210), 157, 9,
        x + (esquerda ? 210 : -210), 157, 213);
      brilho.addColorStop(0, tema.cor);
      brilho.addColorStop(1, "#00000000");
      ctx.globalAlpha = flash * 0.4 + confronto * 0.1;
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = brilho;
      ctx.fillRect(0, 0, LARGURA, 340);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    ctx.textAlign = esquerda ? "left" : "right";
    ctx.fillStyle = tema.brilho;
    ctx.font = "italic 900 26px 'Bahnschrift', 'Arial Black', sans-serif";
    ctx.fillText(esquerda ? "P1" : jogo.modo === "1p" ? "CPU" : "P2", x, 35);
    if (confirmado) {
      ctx.fillStyle = "#fff2cd";
      ctx.font = "bold 12px 'Segoe UI', sans-serif";
      ctx.fillText("CONFIRMADO", x, 54);
    }
    this._ficha(jogo, ctx, cel, esquerda, tema, t);
  }

  _ficha(jogo, ctx, cel, esquerda, tema, t) {
    const x = esquerda ? 25 : LARGURA - 25;
    const largura = 410;
    const inicio = esquerda ? x : x - largura;
    const nome = cel.pers ? jogo.recursos.nome(cel.pers) : "ALEATÓRIO";
    const ficha = cel.pers ? jogo.recursos.ficha(cel.pers) : null;
    const grad = ctx.createLinearGradient(inicio, 0, inicio + largura, 0);
    grad.addColorStop(esquerda ? 0 : 1, tema.forte);
    grad.addColorStop(esquerda ? 1 : 0, "#12121c");
    ctx.save();
    ctx.globalAlpha = 0.45 + 0.55 * t;
    ctx.translate((esquerda ? -1 : 1) * (1 - t) * 18, 0);
    ctx.fillStyle = grad;
    ctx.strokeStyle = tema.cor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(inicio + (esquerda ? 0 : 18), 277);
    ctx.lineTo(inicio + largura, 277);
    ctx.lineTo(inicio + largura - (esquerda ? 18 : 0), 321);
    ctx.lineTo(inicio, 321);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = esquerda ? "left" : "right";
    const textoX = x + (esquerda ? 14 : -14);
    ctx.fillStyle = "#fff5e8";
    ctx.font = "italic 900 37px 'Bahnschrift Condensed', 'Arial Narrow', 'Arial Black', sans-serif";
    ctx.fillText(nome.toUpperCase(), textoX, 310, largura - 35);
    ctx.fillStyle = "#10131de8";
    ctx.fillRect(inicio, 324, largura, 55);
    ctx.fillStyle = "#f3e5cf";
    ctx.font = "bold 13px 'Segoe UI', sans-serif";
    const especialidade = AMBIENTES_SELECT[cel.pers]?.[2];
    const estilo = ficha ? ficha.estilo.toUpperCase() : "SORTEAR LUTADOR";
    const dificuldade = ficha ? `   ·   DIFICULDADE ${ficha.dificuldade}/5` : "";
    ctx.fillText(estilo + dificuldade, textoX, 340, largura - 26);
    ctx.font = "12px 'Segoe UI', sans-serif";
    ctx.fillStyle = "#c0c5d1";
    const lore = ficha?.lore?.find((frase) => !frase.startsWith("Especialidade:"));
    const linha = [especialidade, lore].filter(Boolean).join("  ·  ");
    ctx.fillText(linha || "Escolha um personagem do elenco ao acaso.", textoX, 356, largura - 28);
    if (ficha) {
      ctx.fillStyle = tema.brilho;
      ctx.font = "bold 11px 'Segoe UI', sans-serif";
      const { forca, velocidade, defesa, especial } = ficha.atributos;
      const atributos = `FOR ${forca}   ·   VEL ${velocidade}   ·   DEF ${defesa}   ·   ESP ${especial}`;
      ctx.fillText(atributos, textoX, 372, largura - 30);
    }
    ctx.restore();
  }

  _centro(jogo, ctx, confronto) {
    const S = jogo.select;
    ctx.textAlign = "center";
    ctx.fillStyle = "#0c0e19d9";
    ctx.fillRect(LARGURA / 2 - 26, 14, 52, 28);
    ctx.strokeStyle = "#967c5959";
    ctx.strokeRect(LARGURA / 2 - 26, 14, 52, 28);
    ctx.font = "bold 18px 'Bahnschrift', 'Segoe UI', sans-serif";
    ctx.fillStyle = S.timer <= 5 ? "#ff7d8b" : SELECT_TEMA.ouro;
    ctx.fillText(String(Math.ceil(S.timer)).padStart(2, "0"), LARGURA / 2, 34);
    if (confronto > 0) {
      ctx.save();
      ctx.globalAlpha = confronto;
      ctx.fillStyle = "#fff1ca";
      ctx.shadowColor = "#e7a85a";
      ctx.shadowBlur = 18;
      ctx.font = "italic 900 86px 'Bahnschrift Condensed', 'Arial Black', sans-serif";
      ctx.fillText("VS", LARGURA / 2, 212);
      ctx.restore();
    }
    ctx.fillStyle = "#0a0c14";
    ctx.fillRect(0, 389, LARGURA, ALTURA - 389);
    ctx.fillStyle = SELECT_TEMA.ouro;
    ctx.fillRect(0, 388, LARGURA, 1);
    ctx.fillStyle = "#f2d6a0";
    ctx.font = "italic 900 22px 'Bahnschrift Condensed', 'Arial Black', sans-serif";
    ctx.fillText("SELECIONE SEU LUTADOR", LARGURA / 2, 409);
  }

  _pintarRetratos(jogo, ctx) {
    for (const [i, cel] of SELECT_CELULAS.entries()) {
      const { x, y, w, h } = retanguloCelulaSelect(i);
      const nomeH = h > 64 ? 17 : 14;
      const img = cel.pers && (jogo.recursos.artesSelecao?.[cel.pers]?.retrato || jogo.recursos.retrato(cel.pers));
      ctx.fillStyle = "#161b28";
      ctx.fillRect(x, y, w, h);
      if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 1, y + 1, w - 2, h - nomeH - 1);
        ctx.clip();
        const escala = Math.max(w / img.width, (h - nomeH) / img.height);
        const iw = img.width * escala, ih = img.height * escala;
        ctx.drawImage(img, x + (w - iw) / 2, y + Math.min(0, (h - nomeH - ih) * 0.28), iw, ih);
        ctx.restore();
      } else {
        ctx.textAlign = "center";
        ctx.fillStyle = SELECT_TEMA.ouro;
        ctx.font = `italic 900 ${Math.floor(h * 0.54)}px 'Arial Black', sans-serif`;
        ctx.fillText("?", x + w / 2, y + (h - nomeH) * 0.73);
      }
      ctx.fillStyle = "#111521";
      ctx.fillRect(x, y + h - nomeH, w, nomeH);
      ctx.font = "bold 10px 'Bahnschrift', 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#f2f0e9";
      ctx.fillText(cel.pers ? jogo.recursos.nome(cel.pers).toUpperCase() : "ALEATÓRIO",
        x + w / 2, y + h - 5, w - 6);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#5e6375";
      ctx.strokeRect(x, y, w, h);
    }
  }

  _grade(jogo, ctx) {
    const S = jogo.select;
    const larguraCanvas = jogo.canvas.width;
    if (!this.retratosBase || this.retratosBase.width !== larguraCanvas) {
      const escala = larguraCanvas / LARGURA;
      const base = this.retratosBase = document.createElement("canvas");
      base.width = larguraCanvas;
      base.height = Math.ceil(97 * escala);
      const atlas = base.getContext("2d");
      atlas.setTransform(escala, 0, 0, escala, 0, -415 * escala);
      this._pintarRetratos(jogo, atlas);
    }
    const h = this.retratosBase.height * LARGURA / larguraCanvas;
    ctx.drawImage(this.retratosBase, 0, 415, LARGURA, h);
    const duplo = S.cursor.p1 === S.cursor.p2;
    for (const slot of ["p1", "p2"]) {
      const { x, y, w, h } = retanguloCelulaSelect(S.cursor[slot]);
      const esquerda = slot === "p1";
      const tema = SELECT_TEMA[slot];
      const largura = duplo ? w / 2 : w;
      const borda = x + (duplo && !esquerda ? largura : 0);
      ctx.save();
      ctx.lineWidth = S.flash[slot] > 0 ? 10 : 6;
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = tema.cor;
      ctx.strokeRect(borda, y, largura, h);
      ctx.globalAlpha = 1;
      ctx.lineWidth = jogo.confirmado[slot] ? 3 : 2;
      ctx.strokeStyle = jogo.confirmado[slot] ? tema.brilho : tema.cor;
      ctx.strokeRect(borda, y, largura, h);
      const etiqueta = esquerda ? x + 2 : x + w - 25;
      ctx.fillStyle = tema.forte;
      ctx.fillRect(etiqueta, y + 2, 23, 14);
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 9px 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(esquerda ? "P1" : jogo.modo === "1p" ? "CPU" : "P2", etiqueta + 11.5, y + 12);
      ctx.restore();
    }
  }
}
