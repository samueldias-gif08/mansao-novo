"use strict";

/* ===========================================================================
   7) PROJÉTIL — viaja na horizontal (ou em ARCO/PARÁBOLA), deixa rastro, some
   na borda/no chão/ao acertar.

   TRAJETÓRIA: por padrão o projétil anda em linha reta na horizontal. Se a
   config tiver "gravidade" > 0 (ver CONFIG.projetilPorPersonagem), ele ganha
   velocidade vertical inicial "vy" e é puxado por "gravidade" a cada segundo,
   descrevendo um ARCO — a fireball PARABÓLICA do P1 nasce daqui sem que P2/P3
   sejam afetados. Colisão (caixa()) e dano permanecem idênticos aos da reta.
   =========================================================================== */

class Projetil {
  constructor(dono, tipo) {
    const base = PROJETEIS[tipo] || PROJETEIS.fireball;
    // Override por PERSONAGEM (sprite): mescla campo a campo sobre o tipo base.
    // É o que torna a fireball parabólica EXCLUSIVA do P1 (mesmo padrão de
    // montarGolpes): sem override, "over" é undefined e usa-se o projétil padrão.
    const over = dono.perfil.projetil?.[tipo] || CONFIG.projetilPorPersonagem[dono.personagem]?.[tipo];
    const cfg = over ? { ...base, ...over } : base;

    this.dono = dono;
    this.tipo = tipo;
    this.dano = cfg.dano;
    this.cor = cfg.cor;
    this.forma = cfg.forma;
    this.alcance = cfg.alcance;
    this.facing = dono.facing;

    // Velocidade horizontal: "vx" (arco) tem prioridade; senão usa "vel" (reta).
    // O facing converte para o lado correto da tela (vale p/ ambos os lados).
    const velH = cfg.vx != null ? cfg.vx : cfg.vel;
    this.vx = velH * this.facing;

    // --- Componentes da PARÁBOLA (0 quando o projétil é reto) ---------------
    // gravidade > 0 ativa o arco; vy é a velocidade vertical inicial (sobe se <0).
    this.gravidade = cfg.gravidade || 0;
    this.vy = cfg.vy || 0;
    // Tempo de vida opcional (s): rede de segurança para o projétil sumir mesmo
    // que, por configuração, ele não cruze nenhuma borda. null = sem limite.
    this.tempoVida = cfg.tempoVida != null ? cfg.tempoVida : null;

    this.x = dono.x + this.facing * (cfg.origem?.[0] ?? 70);
    this.y = cfg.origem ? dono.y + cfg.origem[1] : CHAO_Y - 132;
    this.raio = cfg.raio;
    this.vivo = true;
    this.acertou = false;
    this.t = 0;
    this.tRastro = 0; // acumulador para soltar o rastro
  }

  atualizar(dt) {
    this.t += dt;

    // Integração da física: na reta, gravidade=0 e vy=0 (comportamento antigo
    // intacto). Na parábola, a gravidade acelera vy e o projétil curva o arco.
    if (this.gravidade) this.vy += this.gravidade * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Rastro de partículas (NOVO).
    this.tRastro += dt * 1000;
    if (this.forma !== "laser" && this.tRastro >= CONFIG.particulas.rastroProjetilMs) {
      this.tRastro = 0;
      this.dono.jogo.particulas.rastro(
        this.x - this.facing * this.raio,
        this.y,
        this.cor,
      );
      if (this.forma === "meia-lua")
        this.dono.jogo.particulas.folhas(this.x - this.facing * this.raio, this.y, 1, 55);
    }

    // Some ao sair dos LIMITES do jogo: laterais (sempre) e, no arco, também ao
    // tocar o chão ou subir demais. Some também ao estourar o tempo de vida.
    if (this.x < -40 || this.x > MUNDO_L + 40) this.vivo = false;
    if (this.gravidade && (this.y > CHAO_Y + 10 || this.y < -240))
      this.vivo = false;
    if (this.tempoVida != null && this.t >= this.tempoVida) this.vivo = false;
  }

  caixa() {
    if (this.forma === "laser") {
      return {
        x: this.facing < 0 ? this.x - this.alcance : this.x,
        y: this.y - this.raio,
        w: this.alcance,
        h: this.raio * 2,
      };
    }
    return {
      x: this.x - this.raio,
      y: this.y - this.raio,
      w: this.raio * 2,
      h: this.raio * 2,
    };
  }

  desenhar(ctx) {
    const pulso = 1 + Math.sin(this.t * 18) * 0.12;
    const r = this.raio * pulso;
    if (this.forma === "batida-grave") {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const luz = ctx.createRadialGradient(this.x, this.y, 2, this.x, this.y, r * 1.55);
      luz.addColorStop(0, "#fffbd1");
      luz.addColorStop(0.35, "#f7ff60");
      luz.addColorStop(0.7, this.cor);
      luz.addColorStop(1, "rgba(118,255,47,0)");
      ctx.fillStyle = luz;
      ctx.fillRect(this.x - 2 * r, this.y - 2 * r, 4 * r, 4 * r);
      ctx.strokeStyle = "rgba(243,255,177,0.72)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y, r * 1.45, r * 0.6, this.facing * -0.36, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (this.forma === "pena") {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.scale(this.facing, 1);
      ctx.shadowColor = this.cor;
      ctx.shadowBlur = 9;
      ctx.strokeStyle = this.cor;
      ctx.lineWidth = 2;
      ctx.fillStyle = "#162438";
      ctx.beginPath();
      ctx.moveTo(-r * 1.2, r * 0.5);
      ctx.quadraticCurveTo(-r * 0.56, -r, r * 1.15, -r * 0.53);
      ctx.quadraticCurveTo(r * 0.65, r * 0.55, -r * 1.2, r * 0.5);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r, r * 0.47);
      ctx.lineTo(r * 0.66, -r * 0.32);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (this.forma === "onda-sonica") {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.scale(this.facing, 1);
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = 0.9 - i * 0.23;
        ctx.lineWidth = 3 - i * 0.55;
        ctx.strokeStyle = i === 0 ? "#efe8ff" : this.cor;
        ctx.beginPath();
        ctx.ellipse(-i * 9, 0, r * 0.6, r - i * 5, 0, -Math.PI / 2, Math.PI / 2);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    if (this.forma === "orbe-sombrio" || this.forma === "orbe-carmesim") {
      const carmesim = this.forma === "orbe-carmesim";
      const g = ctx.createRadialGradient(this.x, this.y, 1, this.x, this.y, r * 1.35);
      g.addColorStop(0, carmesim ? "#fff0f4" : "#160b26");
      g.addColorStop(0.53, carmesim ? "#5a0d28" : "#351450");
      g.addColorStop(0.72, this.cor);
      g.addColorStop(1, carmesim ? "#31071b00" : "rgba(100,39,175,0)");
      ctx.fillStyle = g;
      ctx.fillRect(this.x - r * 1.35, this.y - r * 1.35, r * 2.7, r * 2.7);
      return;
    }
    if (this.forma === "laser") {
      const { x, y, w, h } = this.caixa();
      ctx.save();
      ctx.fillStyle = this.cor;
      ctx.shadowColor = this.cor;
      ctx.shadowBlur = 14;
      ctx.fillRect(x, y, w, h);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#f7fdff";
      ctx.fillRect(x, this.y - r * 0.24, w, r * 0.48);
      ctx.restore();
      return;
    }
    if (this.forma === "meia-lua") {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.scale(this.facing, 1);
      ctx.globalCompositeOperation = "lighter";
      const luz = ctx.createLinearGradient(-r, 0, r, 0);
      luz.addColorStop(0, "#168f6080");
      luz.addColorStop(0.6, this.cor);
      luz.addColorStop(1, "#ceffe4");
      ctx.shadowColor = this.cor;
      ctx.shadowBlur = 15;
      ctx.fillStyle = luz;
      ctx.beginPath();
      ctx.moveTo(-r * 0.65, -r);
      ctx.bezierCurveTo(r * 1.55, -r * 0.83, r * 1.55, r * 0.8, -r * 0.7, r);
      ctx.bezierCurveTo(r * 0.56, r * 0.34, r * 0.58, -r * 0.34, -r * 0.65, -r);
      ctx.fill();
      ctx.restore();
      return;
    }
    const g = ctx.createRadialGradient(
      this.x,
      this.y,
      2,
      this.x,
      this.y,
      r * 1.6,
    );
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.4, this.cor);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

