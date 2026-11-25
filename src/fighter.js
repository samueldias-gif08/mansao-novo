"use strict";

/* ===========================================================================
   8) FIGHTER (LUTADOR)
   Física, máquina de estados, vida, animação, combate, combos e especial.
   AGORA: slot (teclas) separado de personagem (sprite); lê de um Controle.
   =========================================================================== */

// Offscreen reutilizável para o flash branco (tinge o sprite respeitando alpha).
const _bufFlash = document.createElement("canvas");
const _bufFlashCtx = _bufFlash.getContext("2d");

// Sombra (penumbra) pixelada: desenhada UMA vez como elipse com borda suave
// em baixíssima resolução. Ao ampliar sem suavização, vira blocos de pixel.
const _bufSombra = document.createElement("canvas");
(function construirSombra() {
  const W = 30,
    H = 9; // resolução base baixa => pixels grandes ao ampliar
  _bufSombra.width = W;
  _bufSombra.height = H;
  const c = _bufSombra.getContext("2d");
  // Gradiente radial num "quadrado unitário"; a escala não uniforme (W,H)
  // transforma o círculo numa elipse achatada com penumbra suave.
  c.save();
  c.scale(W, H);
  const g = c.createRadialGradient(0.5, 0.5, 0, 0.5, 0.5, 0.5);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(0.62, "rgba(0,0,0,0.3)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 1, 1);
  c.restore();
})();

class Fighter {
  constructor(recursos, slot, personagem, x, jogo, controle) {
    this.recursos = recursos;
    this.slot = slot; // "p1"/"p2" -> só para referência/HUD
    this.personagem = personagem; // "p1"/"p2" -> qual SPRITE usar
    this.jogo = jogo;
    this.controle = controle; // ControleTeclado ou ControleIA
    this.nome = recursos.nome(personagem);
    // Frame data PRÓPRIO deste lutador (vem do manifest; default = CONFIG.golpes).
    this.golpes = montarGolpes(recursos.golpes(personagem));
    this.perfil = recursos.manifest.players[personagem]?.combate || {};

    this.x = x;
    this.y = CHAO_Y - (this.perfil.vooPermanente?.altura || 0);
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;
    this.noChao = !this.perfil.vooPermanente;
    this.tempoVoo = 0;
    this.nivelVoo = 0;
    this.velVoo = 0;
    this.patrulha = null;

    this.vidaMax = this.perfil.vida ?? VIDA_MAX;
    this.hp = this.vidaMax;
    this.especial = 0; // barra de especial (0..CONFIG.especial.max)
    this.estado = ESTADOS.IDLE;
    this.estadoTempo = 0;
    this.recargaSombra = 0;
    this.recargaTeleporte = 0;
    this.recargaSonica = 0;
    this.recargaPatrulha = 0;
    this.recargaCasco = 0;
    this.recargaVento = 0;
    this.recargaRaios = 0;
    this.raios = [];
    this.anim = new Animator(recursos, personagem);
    this.anim.tocar("idle");

    this.ultimoImpacto = null;
    this.projetilLancado = false;
    this.golpeAtual = null;
    this.oponente = null;

    // Combos / cancelamento.
    this.janelaCancel = 0; // tempo restante (s) para cancelar
    this.comboContador = 0; // golpes encadeados na sequência atual

    // Anti-combo-infinito (rastreamento no lado do DEFENSOR).
    this.comboRecebido = 0; // hits consecutivos recebidos no combo atual
    this.comboResetTimer = 0; // timer (s) para zerar comboRecebido após pausa no dano

    // Game feel.
    this.flashTimer = 0; // duração restante do flash branco
    this.invencivel = 0; // invencibilidade de wakeup (s); sprite pisca

    // --- Postura de defesa/agachamento (sistema de golpes baixos) ----------
    // Re-derivadas a cada quadro em _processarInput (só valem em estados livres).
    // estaAgachado       = está agachado (CROUCH, ou defendendo agachado).
    // estaDefendendoBaixo = está em DEFESA_BAIXA (agachado + defender = down-back).
    //                       Só essa postura bloqueia golpes "baixo".
    this.estaAgachado = false;
    this.estaDefendendoBaixo = false;

    // --- Backdash defensivo (ESPECIAL + TRÁS, exclusivo do personagem P2) ---
    this.backdashCooldown = 0; // s restantes até liberar outro dash (0 = pronto)
    this.backdashDur = 0; // s — duração efetiva do dash em curso (distância/vel ∨ duracao)

    // --- Dash frontal / investida (ESPECIAL + FRENTE, exclusivo do P1) ------
    this.dashFrenteCooldown = 0; // s restantes até liberar outra investida (0 = pronto)
    this.dashFrenteDur = 0; // s — duração efetiva da investida em curso
  }

  // ---- Consultas ------------------------------------------------------------
  podeAgir() {
    return ESTADOS_LIVRES.has(this.estado);
  }
  estaVivo() {
    return this.estado !== ESTADOS.KO;
  }

  get cargaEspecialHUD() {
    const vento = this.perfil.especial?.recargaVento;
    if (vento) return CONFIG.especial.max * (1 - this.recargaVento / vento);
    const casco = this.perfil.defesaCasco;
    if (casco) return CONFIG.especial.max * Math.max(0, 1 - this.recargaCasco / casco.recarga);
    const recarga = this.perfil.especial?.recarga;
    if (!recarga) return this.especial;
    return CONFIG.especial.max * (1 - this.recargaPatrulha / recarga);
  }

  podeUsarEspecial() {
    return this.cargaEspecialHUD >= CONFIG.especial.custo;
  }

  hurtbox() {
    const agachado = this.estado === ESTADOS.CROUCH ||
      (this.perfil.hurtboxes && this.estado === ESTADOS.BLOCK && this.estaDefendendoBaixo);
    const caixa = this.perfil.hurtboxes?.[agachado ? "baixa" : "normal"];
    if (caixa) {
      const [largura, altura] = caixa;
      return { x: this.x - largura / 2, y: this.y - altura, w: largura, h: altura };
    }
    const meiaL = agachado ? 44 : 38;
    const topo = agachado ? -112 : -186;
    const alt = agachado ? 112 : 186;
    return { x: this.x - meiaL, y: this.y + topo, w: meiaL * 2, h: alt };
  }

  /* HURTBOX DIVIDIDA (sistema de golpes baixos) -----------------------------
     Divide a hurtbox cheia numa linha de "cintura" (~58% da altura a partir do
     topo). A parte de baixo é o quadrante inferior (pernas/pés) — alvo dos
     golpes "baixo"; a de cima é cabeça/tronco — alvo dos golpes "alto".
     Os golpes "medio" usam a hurtbox cheia.
     Como os offsets vêm da hurtbox atual, isso já respeita o agachamento:
     agachado, a hurtbox é mais baixa, então golpes "alto" passam por cima. */
  _linhaCintura(hb) {
    return hb.y + hb.h * 0.58;
  }
  hurtboxAlta() {
    const hb = this.hurtbox();
    const corte = this._linhaCintura(hb);
    return { x: hb.x, y: hb.y, w: hb.w, h: corte - hb.y };
  }
  hurtboxBaixa() {
    const hb = this.hurtbox();
    const corte = this._linhaCintura(hb);
    return { x: hb.x, y: corte, w: hb.w, h: hb.y + hb.h - corte };
  }

  // Retorna a região de hurtbox correspondente ao tipo de altura do golpe.
  hurtboxPara(tipoAltura) {
    if (tipoAltura === "baixo") return this.hurtboxBaixa();
    if (tipoAltura === "alto") return this.hurtboxAlta();
    return this.hurtbox(); // "medio" (ou ausente): corpo inteiro
  }

  // O golpe atual está nos quadros ativos (causando dano)?
  // O TIMING vem SEMPRE do frame data (startup/ativo, em 60fps de referência),
  // medido a partir do início do estado — portanto INDEPENDENTE de quantos
  // sprites a animação tem. É isso que torna as animações escalonáveis: dá para
  // adicionar quadros intermediários (mais fluidez) sem mudar QUANDO o golpe
  // acerta. Se o visual sair de sincronia com o golpe ao adicionar frames,
  // ajuste o "fps" da animação (mantendo a duração) e/ou o "startup" no golpe.
  // OBS: "framesAtivos" no manifest virou LEGADO e não afeta mais o timing.
  _golpeAtivo() {
    const frames60 = this.estadoTempo * 60;
    const fd = this.golpes[this.golpeAtual];
    if (fd && fd.startup != null && fd.ativo != null) {
      return frames60 >= fd.startup && frames60 < fd.startup + fd.ativo;
    }
    // Sem frame data (ex.: super-projétil na pose "item"): janela padrão para o
    // disparo acontecer mesmo assim.
    return frames60 >= 5 && frames60 < 10;
  }

  golpeCorporalAtivo() {
    const impactos = this.golpeAtual === "super"
      ? this.perfil.especial?.impactos : this.golpes[this.golpeAtual]?.impactos;
    if (impactos) {
      return impactos.find((g) => {
        const quadro = this.estadoTempo * 60;
        return quadro >= g.startup && quadro < g.startup + g.ativo;
      }) || null;
    }
    if (this.golpeAtual === "super") return null;
    if (!this.golpeAtual || !this._golpeAtivo()) return null;
    return this.estado === ESTADOS.FIREBALL && this.perfil.projetil
      ? null : this.golpes[this.golpeAtual];
  }

  hitbox(g = this.golpeCorporalAtivo()) {
    if (!g) return null;
    let x1, x2;
    if (this.facing === 1) {
      x1 = this.x + g.alcance[0];
      x2 = this.x + g.alcance[1];
    } else {
      x1 = this.x - g.alcance[1];
      x2 = this.x - g.alcance[0];
    }
    return {
      x: Math.min(x1, x2),
      y: this.y + g.altura[0],
      w: Math.abs(x2 - x1),
      h: g.altura[1] - g.altura[0],
    };
  }

  // ---- Transições de estado -------------------------------------------------
  // golpe: nome do golpe/projétil ao entrar num estado de ataque. Definido
  // ANTES de escolher a animação para que hitbox()/disparo usem o valor certo.
  irPara(estado, forcar = false, golpe = null) {
    if (this.estado === estado && !forcar) return;
    this.estado = estado;
    if (estado !== ESTADOS.LIGHTNING) this.raios.length = 0;
    if (estado !== ESTADOS.CAPTURED) this.anguloCaptura = 0;
    if (estado !== ESTADOS.SPECIAL) this.patrulha = null;
    if (this.perfil.vooPermanente && (estado === ESTADOS.ENTRY || estado === ESTADOS.VICTORY)) {
      this.origemPoseVoo = this.x;
    }
    if (estado === ESTADOS.ENTRY && this.perfil.entradaAndando) this.origemEntrada = this.x;
    this.estadoTempo = 0;
    this.ultimoImpacto = null;
    this.projetilLancado = false;
    this.golpeAtual = golpe;
    this.janelaCancel = 0;
    if (!ESTADOS_GOLPE.has(estado)) this.comboContador = 0;
    this.anim.tocar(this._animDoEstado(estado), true);
  }

  _animDoEstado(estado) {
    const r = this.recursos;
    const fb = (nome, alt) => (r.tem(this.personagem, nome) ? nome : alt);
    switch (estado) {
      case ESTADOS.IDLE:
        return this.perfil.repousoBracos && this.estadoTempo >= this.perfil.repousoBracos
          ? fb("idle_arms", "idle") : "idle";
      case ESTADOS.WALK:
        if (this.perfil.caminhada && this._avancando()) {
          return this.estadoTempo < this.perfil.caminhada ? fb("walk_forward", "walk") : fb("run", "walk");
        }
        return this._avancando() ? fb("run", "walk") : "walk";
      case ESTADOS.JUMP:
        if (this.perfil.vooPermanente) return "jump";
        return this.vy > 0 ? fb("fall", fb("run", "idle")) : fb("jump", fb("run", "idle"));
      case ESTADOS.CROUCH:
        return fb("crouch", fb("item", "idle"));
      case ESTADOS.BLOCK:
        if (this.estaDefendendoBaixo && r.tem(this.personagem, "block_low")) return "block_low";
        return fb("block", "idle");
      case ESTADOS.HIT:
      case ESTADOS.CAPTURED:
        return fb("hit", "idle");
      case ESTADOS.KNOCKDOWN:
        return fb("knockdown", "hit");
      case ESTADOS.GETUP:
        return fb("getup", "idle");
      case ESTADOS.KO:
        return fb("ko", "knockdown");
      case ESTADOS.VICTORY:
        return fb("victory", fb("taunt", "idle"));
      case ESTADOS.TAUNT:
        return fb("taunt", "idle");
      case ESTADOS.FLIGHT:
        return fb("flight", "jump");
      case ESTADOS.TELEPORT:
      case ESTADOS.SHADOW_GUARD:
      case ESTADOS.SHELL_GUARD:
      case ESTADOS.SHELL_EXIT:
      case ESTADOS.LIGHTNING:
        return fb(estado, "block");
      case ESTADOS.PUNCH: {
        // Variantes do soco (punch_step, soco_baixo, ...) usam o sprite de
        // mesmo nome se existir; senão reaproveitam "punch". Assim um golpe
        // novo funciona pela FRAME DATA mesmo antes de ganhar arte própria.
        const g = this.golpeAtual || "punch";
        return r.temSprite(this.personagem, g) ? g : "punch";
      }
      case ESTADOS.KICK:
        return this.golpeAtual || "kick";
      case ESTADOS.THROW_TECH:
        // Sem arte própria de tech: cai para uma pose de recuo/guarda existente.
        return fb("throw_tech", fb("tech", fb("block", "hit")));
      case ESTADOS.BACKDASH:
        // Anim dedicada se existir (assets/sprites/<p>/backdash_*.png + manifest);
        // senão reaproveita uma pose de movimento/recuo já presente no sprite.
        return fb("backdash", fb("dash", fb("run", fb("block", "walk"))));
      case ESTADOS.DASH:
        // Investida frontal: pose dedicada "dash" se existir; senão a corrida
        // "run" (visual de avanço agressivo), com fallbacks finais de segurança.
        return fb("dash", fb("run", fb("walk", "idle")));
      case ESTADOS.FIREBALL:
        return this.golpeAtual || "fireball";
      case ESTADOS.GRAB:
        return fb("grab", fb("item", "punch"));
      case ESTADOS.ENTRY:
      case ESTADOS.LAND:
      case ESTADOS.DEFEAT:
        return fb(estado, "idle");
      case ESTADOS.SPECIAL:
        return fb("special", "item"); // especial usa "special"/"item"
      default:
        return "idle";
    }
  }

  _avancando() {
    const querEsq = this.controle.quer("esquerda");
    const querDir = this.controle.quer("direita");
    if (querDir && this.facing === 1) return true;
    if (querEsq && this.facing === -1) return true;
    return false;
  }

  // ---- Ações ----------------------------------------------------------------
  // movendo  = andando/correndo (usa o passo "punch_step").
  // agachado = em postura baixa (AGACHAR+SOCO) -> dispara o SOCO BAIXO.
  // O nome escolhido vira o golpeAtual: tanto a FRAME DATA (this.golpes[nome])
  // quanto a animação saem dele, então um novo golpe baixo é só uma entrada
  // a mais em CONFIG.golpes/manifest — sem tocar nesta função.
  iniciarSoco(movendo, agachado) {
    if (this.perfil.socoTriplo) {
      this.irPara(ESTADOS.PUNCH, true, "punch_triple");
      return;
    }
    let golpe = "punch";
    const sequencia = this.perfil.socos;
    if (agachado && this.golpes["soco_baixo"]) golpe = "soco_baixo";
    else if (sequencia?.length && this.comboContador > 1)
      golpe = sequencia[Math.min(this.comboContador - 1, sequencia.length - 1)];
    else if (movendo && this.recursos.tem(this.personagem, "punch_step"))
      golpe = "punch_step";
    this.irPara(ESTADOS.PUNCH, true, golpe);
  }

  iniciarChute(agachado, noAr) {
    let anim = "kick";
    if (noAr && this.perfil.chuteAereoGiro && (this.comboContador > 1 || this._avancando()))
      anim = this.perfil.chuteAereoGiro;
    else if (noAr && this.recursos.tem(this.personagem, "kick_jump"))
      anim = "kick_jump";
    else if (agachado && this.recursos.tem(this.personagem, "kick_mid"))
      anim = "kick_mid";
    else if (this.perfil.chutes) {
      const chutes = this.perfil.chutes;
      const chuteCombo = this.comboContador > 1 ? this.perfil.chuteCombo : null;
      const chuteAvanco = this._avancando() ? this.perfil.chuteAvanco : null;
      anim = chuteCombo || chuteAvanco || chutes[Math.max(0, this.comboContador - 1) % chutes.length];
    }
    // Personagem sem o sprite "kick" em pé (ex.: p3/Erick): usa o avanço "lunge"
    // como chute padrão; sem isso o estado KICK travaria (meta nulo nunca termina).
    if (!this.recursos.tem(this.personagem, anim)) {
      if (this.recursos.tem(this.personagem, "lunge")) anim = "lunge";
      else if (this.recursos.tem(this.personagem, "kick_mid")) anim = "kick_mid";
    }
    this.irPara(ESTADOS.KICK, true, anim);
  }

  iniciarProjetil(agachado) {
    let anim = "fireball";
    if (!this.perfil.projetil && agachado && this.recursos.tem(this.personagem, "special"))
      anim = "special";
    if (!this.recursos.tem(this.personagem, anim)) anim = "fireball";
    this.irPara(ESTADOS.FIREBALL, true, anim);
  }

  // NOVO: agarrão (usa pose "item"; ignora defesa; derruba).
  iniciarAgarra() {
    this.irPara(ESTADOS.GRAB, true, "agarra");
    this.vx += (this.perfil.avancoAgarrar || 0) * this.facing;
    this._somChute();
  }

  // THROW TECH: agarrão cancelado por agarrão simultâneo do oponente. Nenhum
  // dano, nenhum arremesso — só um recuo simétrico e a pose de tech. Volta ao
  // neutro sozinho via _transicoes (estado THROW_TECH não é livre nem de golpe).
  techThrow(origemX) {
    this.irPara(ESTADOS.THROW_TECH, true);
    const dir = this.x <= origemX ? -1 : 1; // afasta-se de quem estava à frente
    this.vx = dir * CONFIG.throwTech.empurrao;
    // O tech "quebra" qualquer combo em andamento dos dois lados.
    this.comboRecebido = 0;
    this.comboResetTimer = 0;
  }

  // NOVO: especial (gasta a barra cheia; lança o super-projétil na pose "special").
  iniciarEspecial() {
    const casco = this.perfil.defesaCasco;
    if (casco) {
      if (!this.noChao || !this.podeUsarEspecial()) return;
      this.vx = 0;
      this.vy = 0;
      this.recargaCasco = casco.duracao + casco.recarga;
      this.irPara(ESTADOS.SHELL_GUARD, true);
      this.jogo.audio.bloqueio();
      return;
    }
    if (this.perfil.especial?.efeito === "bumerangue") {
      if (!this.podeUsarEspecial()) return;
      const { distancia, recarga } = this.perfil.especial;
      const alvoX = this.oponente?.x ?? this.x;
      const alcance = Math.min(distancia, Math.max(175, Math.abs(alvoX - this.x) + 118));
      this.patrulha = {
        origemX: this.x,
        origemY: this.y,
        destino: Math.max(40, Math.min(MUNDO_L - 40, this.x + this.facing * alcance)),
        lado: this.facing,
      };
      this.vx = 0;
      this.vy = 0;
      this.recargaPatrulha = recarga;
      this.irPara(ESTADOS.SPECIAL, true, "super");
      this.jogo.audio.especial();
      return;
    }
    if (this.perfil.especial && (!this.podeUsarEspecial() || !this.noChao)) return;
    const vento = this.perfil.especial?.recargaVento;
    if (vento) {
      this.recargaVento = vento;
      this.vx = 0;
      this.jogo.audio.rajadaMorgana();
    } else {
      this.especial = 0;
      if (this.perfil.especial && this.perfil.somChute === "capoeira") this.jogo.audio.capoeira("especial");
      else this.jogo.audio.especial();
    }
    this.irPara(ESTADOS.SPECIAL, true, "super"); // "super" = tipo de projétil
  }

  _iniciarRaios() {
    if (this.recargaRaios > 0 || !this.oponente?.estaVivo()) return;
    const { recarga, impactos } = this.perfil.invocacaoRaios;
    const centro = this.oponente.x;
    const passo = Math.abs(impactos[1].desvio);
    const ladoInterno = centro < 40 + passo ? 1 : centro > MUNDO_L - 40 - passo ? -1 : 0;
    this.raios = impactos.map(({ tempo, desvio }, i) => ({
      tempo,
      x: centro + (ladoInterno ? ladoInterno * passo * i : desvio),
      atingiu: false,
    }));
    this.recargaRaios = recarga;
    this.vx = 0;
    this.irPara(ESTADOS.LIGHTNING, true);
  }

  _somChute() {
    if (this.perfil.somChute === "capoeira") this.jogo.audio.capoeira("chute");
    else this.jogo.audio.chute();
  }

  _iniciarTeleporte() {
    if (!this.noChao || this.recargaTeleporte > 0 || !this.oponente?.estaVivo()) return;
    this.vx = 0;
    this.recargaTeleporte = this.perfil.teleporte.recarga;
    this.teleportou = false;
    this.irPara(ESTADOS.TELEPORT, true);
    this.jogo.audio.especial();
  }

  _atualizarTeleporte() {
    const { troca, duracao } = this.perfil.teleporte;
    const alvo = this.oponente;
    if (this.estadoTempo >= troca && !this.teleportou) {
      this.teleportou = true;
      const lado = -alvo.facing;
      const separacao = (this.hurtbox().w + alvo.hurtbox().w) / 2 + 12;
      const destino = alvo.x + lado * separacao;
      if (alvo.estaVivo() && destino >= 40 && destino <= MUNDO_L - 40) {
        this.jogo.particulas.faiscas(this.x, this.y - 75, 9, "#a36cff", 80);
        this.x = destino;
        this.facing = -lado;
        this.jogo.particulas.faiscas(this.x, this.y - 75, 9, "#a36cff", 80);
      }
    }
    if (this.estadoTempo >= duracao) this.irPara(ESTADOS.IDLE, true);
  }

  /* ESPECIAL DEFENSIVO (P2): dash rápido para TRÁS (esquiva). -------------------
     "Trás" é relativo ao facing — o lutador sempre recua mantendo a orientação
     (encarando o oponente), pois BACKDASH não é estado livre e o facing fica
     congelado durante o movimento. Não gasta a barra de especial nem causa dano;
     reutiliza this.invencivel (mesma flag do wakeup) para os i-frames. O dash é
     dirigido por velocidade constante (sem atrito — ver _fisica) e encerra
     sozinho ao percorrer a distância/duração configurada (ver _transicoes). */
  iniciarBackdash() {
    const cfg = CONFIG.backdash;
    const tras = -this.facing; // oposto de para onde olha = recuo relativo
    this.irPara(ESTADOS.BACKDASH, true);
    this.vx = tras * cfg.vel;
    this.backdashCooldown = cfg.cooldownMs / 1000;
    // Encerra no que vier primeiro: fechar a distância OU estourar a duração.
    this.backdashDur = Math.min(cfg.duracao, cfg.distancia / cfg.vel);
    if (cfg.invulneravel)
      this.invencivel = Math.max(this.invencivel, this.backdashDur);
    this.jogo.audio.pulo(); // "whoosh" leve de esquiva (reaproveita o som de pulo)
  }

  // Pode iniciar o backdash? Exclusivo do personagem configurado, só no chão e
  // com o cooldown zerado. Não depende da barra de especial (é mobilidade).
  podeBackdash() {
    return (
      this.personagem === CONFIG.backdash.exclusivoPersonagem &&
      this.noChao &&
      this.backdashCooldown <= 0
    );
  }

  /* ESPECIAL OFENSIVO (P1): investida rápida para FRENTE. ----------------------
     Espelha iniciarBackdash, mas avança NA DIREÇÃO DO FACING (frente relativa):
     como DASH não é estado livre, o facing fica congelado e o lutador mantém a
     orientação correta (encarando o oponente) durante toda a corrida. Velocidade
     constante (sem atrito — ver _fisica); encerra sozinho ao percorrer a
     distância/duração (ver _transicoes). Não gasta barra nem tem hitbox: a
     colisão de corpos e o clamp de mundo já tratam o encontro com o oponente/
     paredes. i-frames opcionais reutilizam this.invencivel (como o backdash). */
  iniciarDashFrente() {
    const cfg = CONFIG.dashFrente;
    const frente = this.facing; // avança para onde está olhando
    this.irPara(ESTADOS.DASH, true);
    this.vx = frente * cfg.vel;
    this.dashFrenteCooldown = cfg.cooldownMs / 1000;
    // Encerra no que vier primeiro: fechar a distância OU estourar a duração.
    this.dashFrenteDur = Math.min(cfg.duracao, cfg.distancia / cfg.vel);
    if (cfg.invulneravel)
      this.invencivel = Math.max(this.invencivel, this.dashFrenteDur);
    this.jogo.audio.pulo(); // "whoosh" da arrancada (reaproveita o som de pulo)
  }

  // Pode iniciar a investida frontal? Exclusivo do personagem configurado, só no
  // chão e com o cooldown zerado. Não depende da barra de especial (é mobilidade).
  podeDashFrente() {
    return (
      this.personagem === CONFIG.dashFrente.exclusivoPersonagem &&
      this.noChao &&
      this.dashFrenteCooldown <= 0
    );
  }

  ganharEspecial(qtd) {
    this.especial = Math.min(CONFIG.especial.max, this.especial + qtd);
  }

  // Recebe um golpe. info: {dano, knockback, derruba, origemX, ignoraBloqueio}.
  // Retorna um resumo para o Jogo decidir o feedback (partículas/som/shake).
  receberGolpe(info) {
    if (!this.estaVivo()) return { ignorado: true };
    if (this.estado === ESTADOS.SHELL_GUARD) return { bloqueado: true, ko: false };
    if (this.invencivel > 0) return { ignorado: true };
    if (this.estado === ESTADOS.SHADOW_GUARD && !info.ignoraBloqueio) {
      this.comboRecebido = 0;
      this.comboResetTimer = 0;
      return { bloqueado: true, ko: false };
    }

    const atacanteDoLado =
      (info.origemX <= this.x && this.facing === -1) ||
      (info.origemX >= this.x && this.facing === 1);

    // Postura de defesa correta para a ALTURA do golpe (regra clássica):
    //  - "baixo": SÓ DEFESA_BAIXA (agachado + defender) bloqueia. Em pé falha.
    //  - "alto"/"medio": bloqueável em pé ou agachado (defesa alta ou baixa).
    // (Para transformar "alto" em overhead — só defesa em pé —, basta exigir
    //  !this.estaDefendendoBaixo no ramo "alto".)
    const tipoAltura = info.tipoAltura || "medio";
    const posturaCorreta =
      tipoAltura === "baixo" ? this.estaDefendendoBaixo : true;
    const bloqueando =
      this.estado === ESTADOS.BLOCK &&
      atacanteDoLado &&
      !info.ignoraBloqueio &&
      posturaCorreta;

    if (bloqueando) {
      // Defesa: chip mínimo + recuo curto; bloquear quebra o combo recebido.
      const chip = Math.floor(info.dano * 0.15);
      this.hp = Math.max(0, this.hp - chip);
      this.vx = (this.x < info.origemX ? -1 : 1) * 90;
      this.ganharEspecial(CONFIG.especial.ganhoAoApanhar * 0.3);
      this.comboRecebido = 0;
      this.comboResetTimer = 0;
      return { bloqueado: true, ko: false };
    }

    const cc = CONFIG.combo;

    // Scaling de dano: hits consecutivos causam progressivamente menos dano,
    // desincentivando combos longos sem eliminar a mecânica de combo.
    const scalingIdx = Math.min(this.comboRecebido, cc.scalingDano.length - 1);
    const dano = Math.max(
      1,
      Math.round(info.dano * cc.scalingDano[scalingIdx]),
    );

    // Scaling de knockback: cada hit empurra mais para forçar reposicionamento.
    // No 3º hit: knockback × 2,05 — suficiente para quebrar o range do combo.
    const knockback =
      info.knockback * (info.empurraoFixo ? 1 : 1 + cc.pushbackPorHit * this.comboRecebido);

    // Avança o contador e reinicia o timer de reset do combo recebido.
    this.comboRecebido++;
    this.comboResetTimer = cc.comboResetMs / 1000;

    // Após hitMaxSequencia hits consecutivos, forçar knockdown independente do golpe.
    const derruba = info.derruba || this.comboRecebido >= cc.hitMaxSequencia;

    this.hp = Math.max(0, this.hp - dano);
    this.ganharEspecial(CONFIG.especial.ganhoAoApanhar);
    const dir = this.x < info.origemX ? -1 : 1;
    this.vx = dir * knockback * CONFIG.gameFeel.knockbackEscala;
    this.flashTimer = CONFIG.gameFeel.flashMs / 1000;

    if (this.hp <= 0) {
      this.irPara(ESTADOS.KO, true);
      this.vx = dir * 160;
      this.vy = -180;
      this.noChao = false;
      return { bloqueado: false, ko: true, dano };
    } else if (derruba) {
      this.irPara(ESTADOS.KNOCKDOWN, true);
      this.vy = -260;
      this.noChao = false;
      // Knockdown forçado pelo limite de hits: zera o contador para o próximo ciclo.
      if (this.comboRecebido >= cc.hitMaxSequencia) this.comboRecebido = 0;
      return { bloqueado: false, ko: false, derrubou: true, dano };
    } else {
      this.irPara(ESTADOS.HIT, true);
      return { bloqueado: false, ko: false, dano };
    }
  }

  // ---- Atualização por quadro ----------------------------------------------
  atualizar(dt, podeControlar) {
    this.estadoTempo += dt;
    if (this.flashTimer > 0) this.flashTimer -= dt;
    if (this.janelaCancel > 0) this.janelaCancel -= dt;
    if (this.invencivel > 0) this.invencivel -= dt;
    if (this.backdashCooldown > 0) this.backdashCooldown -= dt;
    if (this.dashFrenteCooldown > 0) this.dashFrenteCooldown -= dt;
    if (this.recargaTeleporte > 0) this.recargaTeleporte -= dt;
    if (this.recargaSombra > 0) this.recargaSombra -= dt;
    if (this.recargaSonica > 0) this.recargaSonica -= dt;
    if (this.recargaPatrulha > 0) this.recargaPatrulha = Math.max(0, this.recargaPatrulha - dt);
    if (this.recargaCasco > 0) this.recargaCasco = Math.max(0, this.recargaCasco - dt);
    if (this.recargaVento > 0) this.recargaVento = Math.max(0, this.recargaVento - dt);
    if (this.recargaRaios > 0) this.recargaRaios = Math.max(0, this.recargaRaios - dt);
    if (this.comboResetTimer > 0) {
      this.comboResetTimer -= dt;
      if (this.comboResetTimer <= 0) {
        this.comboResetTimer = 0;
        this.comboRecebido = 0;
      }
    }

    if (this.podeAgir() && this.oponente) {
      this.facing = this.oponente.x >= this.x ? 1 : -1;
    }

    // Pensamento da IA acontece junto do controle (gera intenções deste frame).
    if (podeControlar && this.controle.atualizar)
      this.controle.atualizar(dt, this);

    if (podeControlar) this._processarInput();
    if (this.estado === ESTADOS.TELEPORT) this._atualizarTeleporte();
    if (this.estado === ESTADOS.SHADOW_GUARD && this.estadoTempo >= this.perfil.defesaSombria.duracao) {
      this.irPara(ESTADOS.IDLE, true);
    }

    if (this.estado === ESTADOS.SPECIAL && this.perfil.especial?.avanco) {
      const { avanco } = this.perfil.especial;
      const quadro = Math.floor(this.estadoTempo * 60 + 1e-6);
      if (quadro >= avanco[0] && quadro < avanco[1]) this.vx = avanco[2] * this.facing;
      if (this.perfil.somChute === "capoeira" && quadro % 4 === 0 && quadro < avanco[1]) {
        const angulo = this.estadoTempo * 23;
        this.jogo.particulas.folhas(this.x + Math.cos(angulo) * 44, this.y - 12 + Math.sin(angulo) * 8, 1, 45);
      }
    }
    this._fisica(dt);
    this._transicoes();

    if (this.estado === ESTADOS.WALK || this.estado === ESTADOS.JUMP || this.estado === ESTADOS.BLOCK ||
      (this.estado === ESTADOS.IDLE && this.perfil.repousoBracos))
      this.anim.tocar(this._animDoEstado(this.estado));
    this.anim.atualizar(dt);

    // CROUCH: mantém sempre o frame 0 da pose agachada (item_0).
    // O frame 1 (item_1) é reservado para o agarrão — não deve aparecer ao agachar.
    if (this.estado === ESTADOS.CROUCH && this.anim.anim === "item") this.anim.frame = 0;

    // Lança projétil/super no frame ativo de FIREBALL/SPECIAL.
    if (
      (this.estado === ESTADOS.FIREBALL || (this.estado === ESTADOS.SPECIAL && !this.perfil.especial)) &&
      !this.projetilLancado &&
      this._golpeAtivo()
    ) {
      this.jogo.projeteis.push(new Projetil(this, this.golpeAtual));
      this.projetilLancado = true;
      if (this.perfil.projetil?.[this.golpeAtual]?.som === "grave") this.jogo.audio.graveGreeg();
      else if (this.golpeAtual === "sonic") this.jogo.audio.ondaSonica();
      else if (this.perfil.projetil?.[this.golpeAtual]?.forma === "meia-lua") this.jogo.audio.capoeira("projetil");
      else this.jogo.audio.projetil();
    }
  }

  _processarInput() {
    const acoes = this.controle.consumir();

    /* --- CANCELAMENTO DE COMBO -------------------------------------------
       Se um golpe CANCELÁVEL acertou e ainda estamos na janela, um novo
       comando interrompe a recuperação e encadeia o próximo golpe. */
    if (
      !this.podeAgir() &&
      this.janelaCancel > 0 &&
      this.golpes[this.golpeAtual] &&
      this.golpes[this.golpeAtual].cancelavel &&
      this.comboContador < (this.perfil.maxCombo || CONFIG.combo.maxCombo)
    ) {
      if (acoes.includes("chute")) {
        this.comboContador++;
        this.iniciarChute(false, !this.noChao);
        this._somChute();
        return;
      }
      if (acoes.includes("soco")) {
        this.comboContador++;
        // Cancelamento em combo parte sempre de uma pose de ataque (em pé):
        // não há agachamento aqui, então soco alto padrão.
        this.iniciarSoco(false, false);
        this.jogo.audio.soco();
        return;
      }
      if (
        acoes.includes("especial") &&
        !this.perfil.teleporte &&
        this.podeUsarEspecial() &&
        (!this.perfil.especial || this.noChao || this.perfil.vooPermanente)
      ) {
        this.comboContador++;
        this.iniciarEspecial();
        return;
      }
    }

    // --- Estados livres: deriva movimento/defesa/agachar a cada quadro ---
    if (this.podeAgir()) {
      if (this.perfil.vooPermanente) {
        this._controlarVooPermanente(acoes);
        return;
      }
      const querEsq = this.controle.quer("esquerda");
      const querDir = this.controle.quer("direita");
      const querPula = this.controle.quer("pula");
      const querAgacha = this.controle.quer("agacha");
      const querDefende = this.controle.quer("defende");
      const agachado = this.estado === ESTADOS.CROUCH;

      // Postura padrão deste quadro (sobrescrita nas defesas/agachamento abaixo).
      // Atacar ou andar zera as flags — só BLOCK/CROUCH as ativam.
      this.estaAgachado = false;
      this.estaDefendendoBaixo = false;

      if (acoes.includes("especial") && this.perfil.teleporte) {
        this._iniciarTeleporte();
        return;
      }

      // Ações de borda (prioridade).
      // ESPECIAL + TRÁS = backdash defensivo (P2). Checado ANTES do super: o
      // mesmo botão "especial" vira dash QUANDO se está segurando a direção de
      // recuo. Como é distinguido pela direção, não conflita com o super (sem
      // direção) nem com o Fireball (que é outra tecla, "projetil"). Não custa
      // barra, então independe de this.especial.
      const segurandoTras =
        (this.facing === 1 && querEsq) || (this.facing === -1 && querDir);
      // Para o personagem do dash, ESPECIAL+TRÁS é RESERVADO ao backdash: se
      // estiver em cooldown (ou no ar), o comando é absorvido sem virar super —
      // assim o jogador nunca gasta a barra cheia por engano ao tentar esquivar.
      const querBackdash =
        acoes.includes("especial") &&
        segurandoTras &&
        this.personagem === CONFIG.backdash.exclusivoPersonagem;
      if (querBackdash) {
        if (this.podeBackdash()) this.iniciarBackdash();
        return;
      }
      // ESPECIAL + FRENTE = investida/dash frontal (P1). Espelha o backdash, mas
      // na direção do FACING. Checado ANTES do super pelo mesmo motivo: segurar
      // a direção de AVANÇO reserva o botão "especial" para a investida, sem
      // gastar a barra cheia por engano. Distinguido por direção (frente) — não
      // conflita com o super (sem direção) nem com o backdash (trás/outro pers.).
      const segurandoFrente =
        (this.facing === 1 && querDir) || (this.facing === -1 && querEsq);
      const querDashFrente =
        acoes.includes("especial") &&
        segurandoFrente &&
        this.personagem === CONFIG.dashFrente.exclusivoPersonagem;
      if (querDashFrente) {
        if (this.podeDashFrente()) this.iniciarDashFrente();
        return;
      }
      if (
        acoes.includes("especial") &&
        this.podeUsarEspecial() &&
        this.noChao
      ) {
        this.comboContador = 1;
        this.iniciarEspecial();
        return;
      }
      if (acoes.includes("agarra") && this.noChao) {
        this.comboContador = 1;
        this.iniciarAgarra();
        return;
      }
      if (acoes.includes("soco")) {
        this.comboContador = 1;
        // AGACHAR+SOCO = soco baixo (mesma convenção do AGACHAR+CHUTE = kick_mid).
        this.iniciarSoco(querEsq || querDir, agachado);
        this.jogo.audio.soco();
        return;
      }
      if (acoes.includes("chute")) {
        this.comboContador = 1;
        this.iniciarChute(agachado, !this.noChao);
        this._somChute();
        return;
      }
      if (acoes.includes("projetil")) {
        this.iniciarProjetil(agachado);
        return;
      }
      if (acoes.includes("provoca") && this.noChao) {
        if (this.perfil.invocacaoRaios) {
          this._iniciarRaios();
        } else if (this.perfil.defesaSombria) {
          if (this.recargaSombra <= 0) {
            this.vx = 0;
            this.recargaSombra = this.perfil.defesaSombria.recarga;
            this.irPara(ESTADOS.SHADOW_GUARD, true);
            this.jogo.audio.bloqueio();
          }
        } else if (this.perfil.ondaSonica) {
          if (this.recargaSonica <= 0) {
            this.vx = 0;
            this.recargaSonica = this.perfil.ondaSonica.recarga;
            this.irPara(ESTADOS.FIREBALL, true, "sonic");
          }
        } else if (this.perfil.voo) {
          this.vx = 0;
          this.vy = 0;
          this.irPara(ESTADOS.FLIGHT, true);
          this.jogo.audio.pulo();
        } else {
          this.irPara(ESTADOS.TAUNT, true);
        }
        return;
      }

      if (!this.noChao) {
        // Controle direcional no ar: segura ← ou → para mover lateralmente.
        if (querDir) this.vx = CONFIG.movimento.velPuloLateral;
        else if (querEsq) this.vx = -CONFIG.movimento.velPuloLateral;
        // Sem tecla: momentum atual é preservado (sem atrito no ar — ver _fisica).
        this.irPara(ESTADOS.JUMP);
        return;
      }

      if (querPula) {
        this.vy = -FORCA_PULO * (this.perfil.impulsoPulo || 1);
        this.noChao = false;
        // Velocidade horizontal inicial do pulo (direção pressionada no momento).
        if (querDir) this.vx = CONFIG.movimento.velPuloLateral;
        else if (querEsq) this.vx = -CONFIG.movimento.velPuloLateral;
        else this.vx = 0; // pulo reto
        this.irPara(ESTADOS.JUMP, true);
        this.jogo.audio.pulo();
        return;
      }
      if (querDefende) {
        this.vx = 0;
        // DEFESA_BAIXA = defender + agachar (down-back): bloqueia golpes baixos.
        // DEFESA_ALTA  = só defender (em pé): NÃO bloqueia golpes baixos.
        this.estaAgachado = querAgacha;
        this.estaDefendendoBaixo = querAgacha;
        this.irPara(ESTADOS.BLOCK);
        return;
      }
      if (querAgacha) {
        this.vx = 0;
        this.estaAgachado = true; // agachado sem defender (esquiva de altos)
        this.irPara(ESTADOS.CROUCH);
        return;
      }

      if (querEsq || querDir) {
        const dir = querDir ? 1 : -1;
        const avancando = dir === this.facing;
        const correndo = avancando && (!this.perfil.caminhada ||
          (this.estado === ESTADOS.WALK && this.estadoTempo >= this.perfil.caminhada));
        this.vx = dir * (correndo ? VEL_CORRER : VEL_ANDAR) * (this.perfil.velocidade || 1);
        this.irPara(ESTADOS.WALK);
      } else {
        this.vx = 0;
        this.irPara(ESTADOS.IDLE);
      }
    }
  }

  _fisica(dt) {
    if (this.perfil.vooPermanente) {
      this._fisicaVooPermanente(dt);
      return;
    }
    if (this.estado === ESTADOS.FLIGHT) {
      const { duracao, altura, velocidade } = this.perfil.voo;
      const rampa = 0.3;
      const t = Math.max(0, Math.min(1, this.estadoTempo / rampa, (duracao - this.estadoTempo) / rampa));
      this.y = CHAO_Y - altura * t * t * (3 - 2 * t);
      this.vy = 0;
      const dir = Number(this.controle.quer("direita")) - Number(this.controle.quer("esquerda"));
      this.vx = dir * velocidade;
    } else if (!this.noChao) {
      this.vy += GRAVIDADE * dt;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.estado === ESTADOS.ENTRY && this.perfil.entradaAndando) {
      const lado = this.slot === "p1" ? 1 : -1;
      const restante = Math.max(0, 1 - this.estadoTempo / this.perfil.entradaAndando);
      this.x = this.origemEntrada - lado * 100 * restante;
    }

    if (
      this.estado !== ESTADOS.WALK &&
      this.estado !== ESTADOS.JUMP &&
      this.estado !== ESTADOS.BACKDASH &&
      this.estado !== ESTADOS.DASH &&
      this.estado !== ESTADOS.FLIGHT
    ) {
      // No chão e fora do andar/dash: desacelera rápido (empurrões, hit stun…).
      this.vx *= Math.pow(0.0008, dt);
      if (Math.abs(this.vx) < 4) this.vx = 0;
    }
    // BACKDASH/DASH: velocidade constante — o movimento é encerrado por
    // _transicoes (distância/duração), não pelo atrito. Recuo/investida nítidos.
    // JUMP: sem atrito passivo — o input controla vx diretamente.
    // Momentum inicial (sem tecla pressionada) é preservado até o pouso.

    if (this.y >= CHAO_Y) {
      const estavaNoAr = !this.noChao;
      this.y = CHAO_Y;
      this.vy = 0;
      this.noChao = true;
      if (estavaNoAr) {
        // Poeira ao pousar (NOVO).
        this.jogo.particulas.poeira(
          this.x,
          CHAO_Y,
          CONFIG.particulas.poeiraPulo,
        );
        if (this.estado === ESTADOS.JUMP || this.estado === ESTADOS.FLIGHT) {
          if (this.estado === ESTADOS.FLIGHT) this.vx = 0;
          this.irPara(this.recursos.tem(this.personagem, "land") ? ESTADOS.LAND : ESTADOS.IDLE, true);
        }
      }
    } else {
      this.noChao = false;
    }

    const margem = 40;
    if (this.x < margem) this.x = margem;
    if (this.x > MUNDO_L - margem) this.x = MUNDO_L - margem;
  }

  _controlarVooPermanente(acoes) {
    const dir = Number(this.controle.quer("direita")) - Number(this.controle.quer("esquerda"));
    const subir = this.controle.quer("pula");
    const descer = this.controle.quer("agacha");
    this.nivelVoo = Number(subir) - Number(descer);
    this.velVoo = 0;
    this.estaAgachado = false;
    this.estaDefendendoBaixo = false;

    if (acoes.includes("especial") && this.podeUsarEspecial()) {
      this.iniciarEspecial();
    } else if (acoes.includes("soco")) {
      this.comboContador = 1;
      this.iniciarSoco(dir !== 0, false);
      this.jogo.audio.soco();
    } else if (acoes.includes("chute")) {
      this.comboContador = 1;
      this.iniciarChute(false, true);
      this._somChute();
    } else if (acoes.includes("projetil")) {
      this.iniciarProjetil(false);
    } else if (acoes.includes("agarra")) {
      this.iniciarAgarra();
    } else if (acoes.includes("provoca")) {
      this.irPara(ESTADOS.PUNCH, true, "beak");
      this.vx = 230 * this.facing;
      this.jogo.audio.corteAr();
    } else if (this.controle.quer("defende")) {
      this.estaDefendendoBaixo = descer;
      this.irPara(ESTADOS.BLOCK);
    } else if (dir !== 0) {
      const avancando = dir === this.facing;
      const rapido = avancando && this.estado === ESTADOS.WALK && this.estadoTempo > this.perfil.caminhada;
      this.velVoo = dir * (rapido ? VEL_CORRER : VEL_ANDAR) * this.perfil.velocidade;
      this.irPara(ESTADOS.WALK);
    } else {
      this.irPara(subir ? ESTADOS.JUMP : descer ? ESTADOS.CROUCH : ESTADOS.IDLE);
    }
  }

  _fisicaVooPermanente(dt) {
    const voo = this.perfil.vooPermanente;
    this.tempoVoo += dt;
    if (this.patrulha) {
      const { origemX, origemY, destino, lado } = this.patrulha;
      const t = Math.min(1, this.estadoTempo / this.perfil.especial.duracao);
      const curva = t === 1 ? 0 : Math.sin(Math.PI * t);
      this.x = origemX + (destino - origemX) * curva;
      this.y = Math.max(CHAO_Y - voo.maxima, origemY - 30 * curva * curva);
      this.facing = t < 0.5 ? lado : -lado;
      this.anim.tocar(t < 0.4 ? "patrulha_ida" : t < 0.6 ? "patrulha_curva" : "patrulha_volta");
      if (Math.floor((this.estadoTempo - dt) * 24) !== Math.floor(this.estadoTempo * 24)) {
        this.jogo.particulas.folhas(this.x - this.facing * 46, this.y - 78, 2, 52, ["#fff1bf", "#ffc76b"]);
      }
      if (t >= 1) this.irPara(ESTADOS.IDLE, true);
      return;
    }

    const nivel = this.podeAgir() ? this.nivelVoo : 0;
    const altura = nivel > 0 ? voo.maxima - 8 : nivel < 0 ? voo.minima + 5 : voo.altura;
    const bob = 4 * Math.sin(this.tempoVoo * 13);
    const alvoY = CHAO_Y - altura + bob;
    this.vy += ((alvoY - this.y) * 78 - this.vy * 15) * dt;
    this.y = Math.max(CHAO_Y - voo.maxima, Math.min(CHAO_Y - voo.minima, this.y + this.vy * dt));
    const vel = this.podeAgir() ? this.velVoo : 0;
    this.vx += (vel - this.vx) * (1 - Math.exp(-12 * dt));
    this.x += this.vx * dt;

    if (this.estado === ESTADOS.ENTRY) {
      const lado = this.slot === "p1" ? 1 : -1;
      this.x = this.origemPoseVoo - lado * 130 * Math.max(0, 1 - this.estadoTempo / 0.48) ** 2;
    } else if (this.estado === ESTADOS.VICTORY && this.estadoTempo < 0.8) {
      this.x = this.origemPoseVoo + this.facing * 30 * Math.sin(this.estadoTempo / 0.8 * Math.PI * 2);
      this.y = Math.max(CHAO_Y - voo.maxima, this.y - 12 * Math.sin(this.estadoTempo / 0.8 * Math.PI) ** 2);
    }
    this.limitarVooNaArena();
  }

  limitarVooNaArena() {
    if (this.perfil.vooPermanente) this.x = Math.max(40, Math.min(MUNDO_L - 40, this.x));
  }

  _transicoes() {
    switch (this.estado) {
      case ESTADOS.SHELL_GUARD:
        if (this.estadoTempo + 1e-8 >= this.perfil.defesaCasco.duracao)
          this.irPara(ESTADOS.SHELL_EXIT, true);
        break;
      case ESTADOS.ENTRY:
      case ESTADOS.LAND:
      case ESTADOS.SHELL_EXIT:
        if (this.anim.terminou) this.irPara(ESTADOS.IDLE, true);
        break;
      case ESTADOS.PUNCH:
      case ESTADOS.KICK:
      case ESTADOS.GRAB:
        // Recovery frames: o lutador fica preso na pose final pelo tempo de recovery
        // definido no frame data. Isso impede o encadeamento infinito após a chain de
        // cancels — o atacante precisa esperar antes de poder agir novamente.
        // (Cancels ainda funcionam: eles interrompem o recovery do hit anterior.)
        if (this.anim.terminou) {
          const fd = this.golpes[this.golpeAtual];
          const durAnim = this.anim.meta
            ? this.anim.meta.frames / this.anim.meta.fps
            : 0;
          const minDuracao = fd ? durAnim + fd.recovery / 60 : durAnim;
          if (this.estadoTempo >= minDuracao) this.irPara(ESTADOS.IDLE, true);
        }
        break;
      case ESTADOS.FIREBALL:
      case ESTADOS.SPECIAL:
      case ESTADOS.LIGHTNING:
        if (!this.patrulha && this.anim.terminou) this.irPara(ESTADOS.IDLE, true);
        break;
      case ESTADOS.HIT:
        if (this.anim.terminou && this.estadoTempo > 0.25)
          this.irPara(ESTADOS.IDLE, true);
        break;
      case ESTADOS.KNOCKDOWN:
        if ((this.noChao || this.perfil.vooPermanente) && this.estadoTempo > 0.7) {
          this.irPara(ESTADOS.GETUP, true);
          // Invencibilidade começa ao levantar: cobre toda a animação de getup
          // (~0.25 s) + janela de reação ao ficar de pé (~0.4 s).
          if (!this.perfil.vooPermanente) this.invencivel = CONFIG.gameFeel.wakeupInvencivelMs / 1000;
        }
        break;
      case ESTADOS.GETUP:
        if (this.anim.terminou) {
          // Wakeup block: segurar defesa durante o getup entra em guarda.
          if (this.controle.quer("defende")) {
            this.irPara(ESTADOS.BLOCK, true);
          } else {
            this.irPara(ESTADOS.IDLE, true);
          }
        }
        break;
      case ESTADOS.TAUNT:
        if (this.anim.terminou) this.irPara(ESTADOS.IDLE, true);
        break;
      case ESTADOS.THROW_TECH:
        // Trava na pose pela duração configurada (a pose de fallback costuma ter
        // 1 quadro e "terminar" no ato), depois volta ao neutro.
        if (this.estadoTempo >= CONFIG.throwTech.duracaoMs / 1000)
          this.irPara(ESTADOS.IDLE, true);
        break;
      case ESTADOS.BACKDASH:
        // Encerra o dash ao percorrer a distância/duração (o que vier primeiro,
        // já resolvido em backdashDur) e retorna ao neutro, zerando o impulso.
        if (this.estadoTempo >= this.backdashDur) {
          this.vx = 0;
          this.irPara(ESTADOS.IDLE, true);
        }
        break;
      case ESTADOS.DASH:
        // Encerra a investida ao percorrer a distância/duração (resolvido em
        // dashFrenteDur) e retorna ao NEUTRO, zerando o impulso. Colisões com o
        // oponente/paredes durante o trajeto já são tratadas pela separação de
        // corpos e pelo clamp de mundo (não atravessa nada).
        if (this.estadoTempo >= this.dashFrenteDur) {
          this.vx = 0;
          this.irPara(ESTADOS.IDLE, true);
        }
        break;
    }
  }

  // ---- Desenho --------------------------------------------------------------
  // Penumbra pixelada arredondada projetada no chão (CHAO_Y). No ar ela
  // encolhe e clareia, dando sensação de altura.
  _desenharSombra(ctx) {
    const alturaPulo = Math.max(0, CHAO_Y - this.y);
    const k = Math.max(0.45, 1 - alturaPulo / 520); // 1 no chão -> menor no ar
    const w = 120 * k;
    const h = 36 * k;
    ctx.save();
    ctx.imageSmoothingEnabled = false; // mantém os blocos de pixel nítidos
    ctx.globalAlpha = 0.9 * k;
    ctx.drawImage(_bufSombra, this.x - w / 2, CHAO_Y - h / 2 + 2, w, h);
    ctx.restore();
  }

  _desenharEspinhosSombrios(ctx, frente) {
    const tempo = this.estadoTempo;
    const restante = this.perfil.defesaSombria.duracao - tempo;
    const brotar = Math.min(1, (tempo + 0.025) / 0.18);
    const alcance = 1 - (1 - brotar) ** 3;
    const opacidade = Math.min(1, Math.max(0, restante / 0.13));
    const ramos = frente
      ? [[-1, 29, 45, 70], [1, 30, 48, 82]]
      : [[-1, 42, 57, 184], [1, 45, 66, 168]];
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.globalAlpha *= opacidade;
    ctx.lineJoin = "round";
    ctx.lineWidth = 1.35;
    ctx.fillStyle = frente ? "#240f35" : "#1b0a29";
    ctx.strokeStyle = frente ? "#cf8aff" : "#9f55d2";
    ctx.shadowColor = "#9b45e8";
    ctx.shadowBlur = frente ? 5 : 9;

    for (const [lado, raiz, curva, altura] of ramos) {
      const ponto = (t) => {
        const x = raiz + 4 * curva * t * (1 - t) + 15 * t;
        return [lado * x, -altura * t];
      };
      ctx.beginPath();
      for (const borda of [-1, 1]) {
        for (let i = 0; i <= 14; i++) {
          const t = alcance * (borda === -1 ? i : 14 - i) / 14;
          const [x, y] = ponto(t);
          const largura = 5.6 * (1 - t) * (1 - t / alcance) + 0.35;
          ctx.lineTo(x + largura * borda, y);
        }
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      for (let i = 1; i <= 6; i++) {
        const t = i * 0.135;
        if (alcance <= t) break;
        const [x, y] = ponto(t);
        const [baseX, baseY] = ponto(t - 0.05);
        const ladoEspinho = i % 2 ? lado : -lado;
        const tamanho = (22 - t * 8) * Math.min(1, (alcance - t) / 0.12);
        ctx.beginPath();
        ctx.moveTo(baseX, baseY);
        ctx.quadraticCurveTo(x + ladoEspinho * tamanho * 0.35, y, x + ladoEspinho * tamanho, y - tamanho * 0.8);
        ctx.lineTo(x, y - 4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  _desenharVendaval(ctx) {
    const progresso = Math.max(0, Math.min(1, (this.estadoTempo - 0.14) / 0.36));
    if (progresso === 0 || progresso === 1) return;
    ctx.save();
    ctx.translate(this.x, this.y - 80);
    ctx.scale(this.facing, 1);
    ctx.globalAlpha *= Math.sin(progresso * Math.PI);
    for (let i = 0; i < 6; i++) {
      const x = 64 + progresso * 340 - i * 32;
      if (x < 28) continue;
      ctx.lineWidth = i % 2 ? 2 : 5;
      ctx.strokeStyle = i % 2 ? "#c47da8" : "#54253f";
      ctx.beginPath();
      ctx.ellipse(x, i * 11 - 25, 29 + i * 5, 45 - i * 4, -0.39, -1.5, 1.4);
      ctx.stroke();
    }
    ctx.restore();
  }

  _desenharRaio(ctx, x, idade) {
    if (idade < -0.25 || idade >= 0.18) return;
    ctx.save();
    if (idade < 0) {
      const intensidade = 0.38 + 0.62 * (1 + idade / 0.25);
      ctx.globalAlpha *= intensidade;
      const aviso = ctx.createRadialGradient(x, 55, 9, x, 55, 72);
      aviso.addColorStop(0, "#7a316dbf");
      aviso.addColorStop(1, "#24082000");
      ctx.fillStyle = aviso;
      ctx.fillRect(x - 72, 0, 144, 127);
      ctx.strokeStyle = "#f29bce";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.moveTo(x, 73);
      ctx.lineTo(x, CHAO_Y - 10);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.ellipse(x, CHAO_Y - 2, this.perfil.invocacaoRaios.raio, 9, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.globalAlpha *= 1 - idade / 0.18;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x - 8, 0);
      ctx.lineTo(x + 6, CHAO_Y * 0.11);
      ctx.lineTo(x + 24, CHAO_Y * 0.24);
      ctx.lineTo(x + 7, CHAO_Y * 0.32);
      ctx.lineTo(x - 19, CHAO_Y * 0.45);
      ctx.lineTo(x - 5, CHAO_Y * 0.52);
      ctx.lineTo(x + 11, CHAO_Y * 0.65);
      ctx.lineTo(x - 13, CHAO_Y * 0.83);
      ctx.lineTo(x, CHAO_Y);
      for (const [largura, cor] of [[38, "#991cae70"], [26, "#d94287"], [16, "#ffa4d7"], [10, "#fff7fe"]]) {
        ctx.lineWidth = largura;
        ctx.strokeStyle = cor;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.moveTo(x + 24, CHAO_Y * 0.24);
      ctx.lineTo(x + 67, CHAO_Y * 0.36);
      ctx.lineTo(x + 45, CHAO_Y * 0.54);
      ctx.moveTo(x - 19, CHAO_Y * 0.45);
      ctx.lineTo(x - 66, CHAO_Y * 0.57);
      ctx.lineTo(x - 59, CHAO_Y * 0.68);
      ctx.lineTo(x - 89, CHAO_Y * 0.77);
      ctx.moveTo(x - 13, CHAO_Y * 0.83);
      ctx.lineTo(x - 54, CHAO_Y * 0.92);
      ctx.lineTo(x - 66, CHAO_Y - 5);
      ctx.moveTo(x, CHAO_Y);
      ctx.lineTo(x + 41, CHAO_Y - 13);
      ctx.lineTo(x + 65, CHAO_Y - 6);
      for (const [largura, cor] of [[13, "#aa3ebe88"], [7, "#ed73b2"], [3, "#ffe6f6"]]) {
        ctx.lineWidth = largura;
        ctx.strokeStyle = cor;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  desenhar(ctx, debug) {
    const fr = this.recursos.frame(
      this.personagem,
      this.anim.anim,
      this.anim.frame,
    );
    const spriteLuta = this.recursos.manifest.players[this.personagem]?.spriteLuta;
    const escala = ESCALA * (spriteLuta?.escala ?? this.perfil.escalaSprite ?? 1);
    const dw = this.recursos.frameW * escala;
    const dh = this.recursos.frameH * escala;
    const dx = this.x - dw / 2;
    // Compensa a margem transparente do sprite depois de redimensioná-lo.
    const dy = this.y - dh + (spriteLuta?.ajusteY ?? 0) * ESCALA;

    this._desenharSombra(ctx); // penumbra no chão, sob o personagem

    if (this.estado === ESTADOS.SPECIAL && this.perfil.especial?.recargaVento) this._desenharVendaval(ctx);
    if (this.estado === ESTADOS.LIGHTNING) {
      for (const raio of this.raios) this._desenharRaio(ctx, raio.x, this.estadoTempo - raio.tempo);
    } else if (this.estado === ESTADOS.VICTORY && this.perfil.invocacaoRaios) {
      this._desenharRaio(ctx, this.x - this.facing * 110, this.estadoTempo - 0.53);
    }

    if (this.estado === ESTADOS.SHELL_GUARD) {
      const oscilacao = Math.sin(this.estadoTempo * 18);
      const altura = this.estadoTempo < 0.16 ? 68 : 53;
      const brilho = ctx.createRadialGradient(this.x, this.y - altura, 28, this.x, this.y - altura, 89);
      brilho.addColorStop(0, "rgba(152,247,51,0.1)");
      brilho.addColorStop(0.68, "rgba(203,255,80,0.42)");
      brilho.addColorStop(1, "rgba(255,211,64,0)");
      ctx.save();
      ctx.fillStyle = brilho;
      ctx.fillRect(this.x - 89, this.y - altura - 89, 178, 178);
      ctx.strokeStyle = "rgba(217,248,115,0.8)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y - altura, 78 + oscilacao * 3, 51, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (this.patrulha || (this.golpeAtual === "beak" && this._golpeAtivo())) {
      ctx.save();
      ctx.translate(this.x, this.y - 96);
      ctx.scale(this.facing, 1);
      const cortando = !this.patrulha;
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = i === 0 ? "rgba(255,246,201,0.88)" : "rgba(255,166,49,0.59)";
        ctx.lineWidth = 4 - i;
        ctx.beginPath();
        ctx.ellipse(cortando ? 72 : -i * 16, i * 8, 48 + i * 11, 20 + i * 5, -0.19,
          cortando ? -1.35 : 0.65, cortando ? 1.25 : Math.PI * 1.58);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (this.estado === ESTADOS.SPECIAL && this.perfil.especial?.efeito === "tornado") {
      const giro = this.estadoTempo * 25;
      ctx.save();
      ctx.translate(this.x + this.facing * 22, this.y - 22);
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 5; i++) {
        ctx.strokeStyle = i % 2 ? "rgba(203,178,255,0.73)" : "rgba(126,97,241,0.55)";
        ctx.beginPath();
        ctx.ellipse(0, -i * 28, 69 - i * 4, 11, -0.13 * this.facing,
          giro + i, giro + i + Math.PI * 1.25);
        ctx.stroke();
      }
      ctx.restore();
    }

    const defesaSombria = this.estado === ESTADOS.SHADOW_GUARD;
    const teleportando = this.estado === ESTADOS.TELEPORT;
    if (defesaSombria || teleportando) {
      const gradiente = ctx.createRadialGradient(this.x, this.y - 92, 12, this.x, this.y - 92, 103);
      gradiente.addColorStop(0, "rgba(19,8,29,0.62)");
      gradiente.addColorStop(0.65, "rgba(81,27,132,0.43)");
      gradiente.addColorStop(1, "rgba(117,60,183,0)");
      ctx.fillStyle = gradiente;
      ctx.fillRect(this.x - 104, this.y - 196, 208, 208);
    }
    if (defesaSombria) this._desenharEspinhosSombrios(ctx, false);

    if (this.estado === ESTADOS.FLIGHT) {
      ctx.save();
      ctx.strokeStyle = "rgba(133,229,255,0.65)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.ellipse(this.x, this.y + 4 + 7 * i, 24 - 6 * i, 4, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.save();
    if (this.estado === ESTADOS.CAPTURED && this.anguloCaptura) {
      const centroY = this.y - 72;
      ctx.translate(this.x, centroY);
      ctx.rotate(this.anguloCaptura);
      ctx.translate(-this.x, -centroY);
    }
    if (teleportando) {
      const { troca, duracao } = this.perfil.teleporte;
      const visibilidade = this.estadoTempo < troca
        ? 1 - this.estadoTempo / troca
        : (this.estadoTempo - troca) / (duracao - troca);
      ctx.globalAlpha *= Math.max(0.05, Math.min(1, visibilidade));
    }
    if (this.facing === -1) {
      ctx.translate(this.x, 0);
      ctx.scale(-1, 1);
      ctx.translate(-this.x, 0);
    }

    // Flicker durante invencibilidade de wakeup (oculta a cada ~2 frames visuais).
    const flickerOculto =
      this.invencivel > 0 && Math.floor(this.invencivel * 14) % 2 === 0;

    if (fr && fr.ok) {
      if (!flickerOculto) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(fr.img, dx, dy, dw, dh);

        // FLASH BRANCO: redesenha o sprite tingido respeitando o alpha (NOVO).
        if (this.flashTimer > 0) {
          const intensidade = Math.min(
            1,
            this.flashTimer / (CONFIG.gameFeel.flashMs / 1000),
          );
          const fw = this.recursos.frameW,
            fh = this.recursos.frameH;
          if (_bufFlash.width !== fw) {
            _bufFlash.width = fw;
            _bufFlash.height = fh;
          }
          _bufFlashCtx.clearRect(0, 0, fw, fh);
          _bufFlashCtx.drawImage(fr.img, 0, 0, fw, fh);
          _bufFlashCtx.globalCompositeOperation = "source-atop";
          _bufFlashCtx.fillStyle = `rgba(255,255,255,${0.85 * intensidade})`;
          _bufFlashCtx.fillRect(0, 0, fw, fh);
          _bufFlashCtx.globalCompositeOperation = "source-over";
          ctx.drawImage(_bufFlash, dx, dy, dw, dh);
        }
      }
    } else {
      ctx.fillStyle = "rgba(220,60,90,0.85)";
      ctx.fillRect(this.x - 40, this.y - 180, 80, 180);
      ctx.fillStyle = "#fff";
      ctx.font = "12px monospace";
      ctx.textAlign = "center";
      ctx.fillText(this.personagem, this.x, this.y - 95);
      ctx.fillText(this.anim.anim + ":" + this.anim.frame, this.x, this.y - 80);
    }
    ctx.restore();

    if (defesaSombria) this._desenharEspinhosSombrios(ctx, true);
    const orbe = this.perfil.projetil?.fireball;
    if (this.estado === ESTADOS.FIREBALL && orbe?.forma === "orbe-carmesim" && !this.projetilLancado) {
      const x = this.x + this.facing * (orbe.origem[0] - 9);
      const y = this.y + orbe.origem[1];
      const r = 6 + 14 * Math.min(1, this.estadoTempo * 8);
      ctx.save();
      const brilho = ctx.createRadialGradient(x, y, 1, x, y, r);
      brilho.addColorStop(0, "#fff4f0");
      brilho.addColorStop(0.35, "#f24579");
      brilho.addColorStop(1, "#480e2600");
      ctx.fillStyle = brilho;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.restore();
    }

    if (debug) {
      const hb = this.hurtbox();
      ctx.strokeStyle = "#3df";
      ctx.strokeRect(hb.x, hb.y, hb.w, hb.h);
      // Quadrante inferior (pernas/pés): alvo dos golpes "baixo".
      const hbBaixa = this.hurtboxBaixa();
      ctx.strokeStyle = this.estaDefendendoBaixo ? "#3f9" : "#fa0";
      ctx.strokeRect(hbBaixa.x, hbBaixa.y, hbBaixa.w, hbBaixa.h);
      const hit = this.hitbox();
      if (hit) {
        ctx.strokeStyle = "#f33";
        ctx.strokeRect(hit.x, hit.y, hit.w, hit.h);
      }
      // Frame data do golpe atual (NOVO no debug).
      if (this.golpeAtual && this.golpes[this.golpeAtual]) {
        const fd = this.golpes[this.golpeAtual];
        ctx.fillStyle = "#ff3";
        ctx.font = "11px monospace";
        ctx.textAlign = "center";
        ctx.fillText(
          `${this.golpeAtual} s${fd.startup}/a${fd.ativo}/r${fd.recovery} d${fd.dano}`,
          this.x,
          this.y - 200,
        );
      }
    }
  }
}

