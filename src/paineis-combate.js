"use strict";

const ACOES_PAINEL_COMBATE = [
  ["Andar / Correr", "↔", "esquerda", "direita"],
  ["Pular", "↥", "pula"],
  ["Agachar", "↧", "agacha"],
  ["Soco", "✊︎", "soco"],
  ["Chute", "➚", "chute"],
  ["Projétil", "➤", "projetil"],
  ["Agarrão", "✋︎", "agarra"],
  ["Especial", "ϟ", "especial"],
  ["Defender", "⛨", "defende"],
  ["Provocar", "♪", "provoca"],
];

const ROTULOS_SETAS = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
};

class PaineisCombate {
  constructor(palco, entrada) {
    this.palco = palco;
    this.entrada = entrada;
    this.visivel = false;
    this.teclas = [];
    this.rotulos = {};
    this.paineis = ["p1", "p2"].map((slot) => {
      this.rotulos[slot] = {};
      const painel = palco.querySelector(`.painel-combate--${slot}`);
      const lista = painel.querySelector("dl");
      for (const [nome, simbolo, ...acoes] of ACOES_PAINEL_COMBATE) {
        const linha = document.createElement("div");
        const rotulo = document.createElement("dt");
        const icone = document.createElement("span");
        icone.className = "icone-combate";
        icone.setAttribute("aria-hidden", "true");
        icone.textContent = simbolo;
        const texto = document.createTextNode(nome);
        rotulo.append(icone, texto);
        this.rotulos[slot][acoes[0]] = texto;

        const atalhos = document.createElement("dd");
        for (const acao of acoes) {
          const codigo = TECLAS[slot][acao];
          const tecla = document.createElement("kbd");
          tecla.textContent = ROTULOS_SETAS[codigo] || codigo.slice(3);
          atalhos.append(tecla);
          this.teclas.push({ codigo, tecla });
        }
        linha.append(rotulo, atalhos);
        lista.append(linha);
      }
      return painel;
    });
  }

  definirLutador(slot, perfil) {
    const rotulos = this.rotulos[slot];
    const laser = perfil.projetil?.super?.forma === "laser";
    rotulos.esquerda.data = perfil.vooPermanente ? "Voar lateralmente" : "Andar / Correr";
    rotulos.pula.data = perfil.vooPermanente ? "Subir" : "Pular";
    rotulos.agacha.data = perfil.vooPermanente ? "Descer" : "Agachar";
    rotulos.soco.data = perfil.socoTriplo ? "Soco triplo" : "Soco";
    rotulos.especial.data = perfil.defesaCasco?.rotulo || perfil.teleporte?.rotulo ||
      perfil.especial?.rotulo || (laser ? "Raio laser" : "Especial");
    rotulos.provoca.data = perfil.invocacaoRaios?.rotulo || perfil.vooPermanente?.rotuloGolpe || perfil.defesaSombria?.rotulo ||
      perfil.ondaSonica?.rotulo || (perfil.voo ? "Voar (2 s)" : "Provocar");
  }

  atualizar(visivel) {
    if (this.visivel !== visivel) {
      this.visivel = visivel;
      this.palco.classList.toggle("com-instrucoes", visivel);
      for (const painel of this.paineis) painel.hidden = !visivel;
    }
    if (!visivel) return;

    for (const { codigo, tecla } of this.teclas) {
      tecla.classList.toggle("pressionada", this.entrada.estaPressionada(codigo));
    }
  }
}
