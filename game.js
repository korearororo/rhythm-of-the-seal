/* Phaser를 CDN으로만 불러오는, 설치 없는 전투 프로토타입입니다. */
const WIDTH = 900;
const HEIGHT = 620;

const ENEMY_INTENT_DEFS = {
  attack: { key: 'attack', name: '일반 공격', detail: '단검을 휘두릅니다.', damage: 5 },
  defend: { key: 'defend', name: '방어', detail: '방패를 들어 피해를 줄입니다.' },
  charge: { key: 'charge', name: '힘 모으기', detail: '다음 턴 강공격을 준비합니다.' },
  heavy: { key: 'heavy', name: '강공격', detail: '거칠게 내려찍습니다!', damage: 10 },
};

// 다음 세션에서 새 적을 추가할 때는 ENEMY_PRESETS에 새 객체만 추가하면 됩니다.
// 필요한 항목: 로그명/표시명, 최대 HP, 행동 예고 순서, 스프라이트.
const ENEMY_PRESETS = {
  goblin: {
    id: 'goblin',
    displayName: '고블린 정찰병',
    logName: '고블린 정찰병',
    maxHp: 40,
    sprite: { texture: 'characters', frame: 'goblin', x: 755, y: 225, scale: 164, flipX: true },
    intentSequence: ['attack', 'defend', 'charge', 'heavy'],
    encounterLabel: '고블린 정찰병과 조우했다',
  },
  skeleton: {
    id: 'skeleton',
    displayName: '해골 성소지기',
    logName: '해골 성소지기',
    maxHp: 48,
    sprite: { texture: 'skeleton-shrine-keeper', frame: 'idle', x: 760, y: 224, scale: 118, flipX: false },
    intentSequence: ['defend', 'attack', 'charge', 'heavy', 'attack'],
    encounterLabel: '해골 성소지기와 조우했다',
  },
  arbiter: {
    id: 'arbiter',
    displayName: '봉인 심판관',
    logName: '봉인 심판관',
    maxHp: 64,
    sprite: { texture: 'seal-arbiter', frame: 'idle', x: 748, y: 183, scale: 210, flipX: false },
    intentSequence: ['defend', 'attack', 'charge', 'heavy', 'attack'],
    encounterLabel: '심장석의 마지막 수호자 · 봉인 심판관',
    boss: { phaseThreshold: 32, attackDamage: [6, 7], heavyDamage: 12, exposedFinisherDamage: 24 },
  },
};

const ENEMY_ORDER = ['goblin', 'skeleton', 'arbiter'];

function pixelSprite(scene, x, y, texture, frame, height, alpha = 1) {
  const sprite = scene.add.image(x, y, texture, frame).setAlpha(alpha);
  return sprite.setScale(height / sprite.height);
}

function validateEnemyPresets() {
  const issues = [];
  if (!Array.isArray(ENEMY_ORDER) || ENEMY_ORDER.length === 0) {
    issues.push('ENEMY_ORDER가 비어 있거나 배열이 아닙니다.');
  }

  for (const enemyId of ENEMY_ORDER) {
    if (!Object.prototype.hasOwnProperty.call(ENEMY_PRESETS, enemyId)) {
      issues.push(`ENEMY_ORDER에 '${enemyId}'가 포함되었지만 ENEMY_PRESETS에 정의되지 않았습니다.`);
    }
  }

  Object.entries(ENEMY_PRESETS).forEach(([presetId, enemy]) => {
    if (!enemy.id || typeof enemy.id !== 'string') issues.push(`${presetId}: id가 없거나 문자열이 아닙니다.`);
    if (!enemy.displayName || typeof enemy.displayName !== 'string') issues.push(`${presetId}: displayName이 없거나 문자열이 아닙니다.`);
    if (!enemy.logName || typeof enemy.logName !== 'string') issues.push(`${presetId}: logName이 없거나 문자열이 아닙니다.`);
    if (typeof enemy.maxHp !== 'number' || !Number.isFinite(enemy.maxHp) || enemy.maxHp <= 0) issues.push(`${presetId}: maxHp가 0보다 큰 숫자가 아닙니다.`);

    if (!enemy.sprite || typeof enemy.sprite !== 'object') {
      issues.push(`${presetId}: sprite 객체가 없습니다.`);
    } else {
      if (!enemy.sprite.texture || typeof enemy.sprite.texture !== 'string') issues.push(`${presetId}: sprite.texture가 없습니다.`);
      if (!enemy.sprite.frame || typeof enemy.sprite.frame !== 'string') issues.push(`${presetId}: sprite.frame이 없습니다.`);
      ['x', 'y', 'scale'].forEach((axis) => {
        const value = enemy.sprite[axis];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          issues.push(`${presetId}: sprite.${axis}가 숫자가 아닙니다.`);
        }
      });
    }

    if (!Array.isArray(enemy.intentSequence) || enemy.intentSequence.length === 0) {
      issues.push(`${presetId}: intentSequence가 비어 있거나 배열이 아닙니다.`);
    } else {
      enemy.intentSequence.forEach((intentKey) => {
        if (!ENEMY_INTENT_DEFS[intentKey]) {
          issues.push(`${presetId}: intentSequence의 '${intentKey}'가 ENEMY_INTENT_DEFS에 없습니다.`);
        }
      });
      if (enemy.boss) {
        enemy.intentSequence.forEach((intentKey, index, sequence) => {
          if (intentKey === 'charge' && sequence[(index + 1) % sequence.length] !== 'heavy') {
            issues.push(`${presetId}: 힘 모으기 바로 뒤에는 차단할 강공격이 있어야 합니다.`);
          }
        });
      }
    }
  });

  if (issues.length > 0) {
    throw new Error(`[ENEMY_PRESETS 검증 실패]\n${issues.join('\n')}`);
  }
}

class BootScene extends Phaser.Scene {
  constructor() { super('boot'); }

  preload() {
    this.load.image('shrine-kit', 'assets/shrine-kit.png');
    this.load.image('characters', 'assets/characters.png');
    this.load.image('skeleton-shrine-keeper', 'assets/skeleton-shrine-keeper.png');
    this.load.image('seal-arbiter', 'assets/seal-arbiter.png');
    this.load.image('combat-effects', 'assets/combat-effects.png');
  }

  create() {
    validateEnemyPresets();

    const shrine = this.textures.get('shrine-kit');
    shrine.add('arch', 0, 0, 0, 680, 770);
    shrine.add('pillar-left', 0, 680, 60, 230, 690);
    shrine.add('pillar-right', 0, 910, 80, 250, 680);
    shrine.add('rune', 0, 1140, 320, 396, 440);
    shrine.add('floor-strip', 0, 0, 760, 1536, 264);

    const characters = this.textures.get('characters');
    characters.add('novice', 0, 20, 20, 760, 820);
    characters.add('goblin', 0, 990, 70, 784, 817);

    const skeleton = this.textures.get('skeleton-shrine-keeper');
    skeleton.add('idle', 0, 0, 0, 1312, 1199);

    const sealArbiter = this.textures.get('seal-arbiter');
    sealArbiter.add('idle', 0, 0, 0, 1312, 1199);

    const effects = this.textures.get('combat-effects');
    effects.add('attack', 0, 0, 0, 724, 724);
    effects.add('guard', 0, 724, 0, 724, 724);
    effects.add('rhythm', 0, 1448, 0, 724, 724);
    this.scene.start('intro');
  }
}

class IntroScene extends Phaser.Scene {
  constructor() { super('intro'); }

  create() {
    this.cameras.main.setBackgroundColor('#171024');
    this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x171024);
    pixelSprite(this, WIDTH / 2, 287, 'shrine-kit', 'arch', 450, .46);
    pixelSprite(this, WIDTH / 2, 520, 'shrine-kit', 'floor-strip', 155, .72);
    pixelSprite(this, 196, 404, 'characters', 'novice', 146, .9).setFlipX(true);
    pixelSprite(this, 704, 400, 'shrine-kit', 'rune', 108, .8);
    this.add.text(WIDTH / 2, 82, '봉인의 박자', { fontFamily: 'monospace', fontSize: '34px', fontStyle: 'bold', color: '#ffd56a' }).setOrigin(.5);
    this.add.text(WIDTH / 2, 142, '성소 입구', { fontFamily: 'monospace', fontSize: '18px', fontStyle: 'bold', color: '#f8f1ff' }).setOrigin(.5);
    this.add.rectangle(WIDTH / 2, 286, 660, 172, 0x2a1d3b).setStrokeStyle(3, 0x9d7bbf);
    this.add.text(WIDTH / 2, 220, '성벽 아래 오래된 성소의 봉인이 흔들린다.', { fontFamily: 'monospace', fontSize: '15px', color: '#f8f1ff' }).setOrigin(.5);
    this.add.text(WIDTH / 2, 258, '수습 기사는 박동에 동조하는 검을 들고\n정찰 중인 고블린을 지나 안으로 향한다.', { fontFamily: 'monospace', fontSize: '14px', color: '#c6b6d8', align: 'center', lineSpacing: 8 }).setOrigin(.5);
    this.add.text(WIDTH / 2, 410, '적의 예고를 읽고 리듬을 쌓으세요.', { fontFamily: 'monospace', fontSize: '13px', color: '#ffd56a' }).setOrigin(.5);
    this.makeButton('성소 안으로', 450, 500, 220, 50, 0x765199, () => {
      this.registry.set('battleOrder', ENEMY_ORDER);
      this.registry.set('battleIndex', 0);
      this.scene.start('battle');
    });
  }

  makeButton(label, x, y, w, h, color, callback) {
    const bg = this.add.rectangle(0, 0, w, h, color).setStrokeStyle(3, 0xf8f1ff);
    const text = this.add.text(0, 0, label, { fontFamily: 'monospace', fontSize: '15px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(.5);
    const button = this.add.container(x, y, [bg, text]).setSize(w, h).setInteractive({ useHandCursor: true });
    button.on('pointerover', () => bg.setFillStyle(0xffd56a));
    button.on('pointerout', () => bg.setFillStyle(color));
    button.on('pointerdown', callback);
  }
}

class BattleScene extends Phaser.Scene {
  constructor() { super('battle'); }

  create() {
    this.battleOrder = this.registry.get('battleOrder') || ENEMY_ORDER;
    const battleIndex = this.registry.get('battleIndex') || 0;
    const enemyKey = this.battleOrder[battleIndex] || ENEMY_ORDER[0];
    this.enemyConfig = ENEMY_PRESETS[enemyKey] || ENEMY_PRESETS.goblin;
    this.enemyIndex = battleIndex;
    this.colors = { ink: 0x1a1224, panel: 0x2a1d3b, border: 0x9d7bbf, gold: 0xffd56a, hp: 0xeb5b67, green: 0x79bf78, muted: 0xa99bb9, white: 0xf8f1ff };
    this.buildBackground();
    this.buildUi();
    this.resetBattle();
  }

  text(x, y, value, size = 14, color = '#f8f1ff', align = 'left') {
    return this.add.text(x, y, value, { fontFamily: 'monospace', fontSize: `${size}px`, fontStyle: 'bold', color, align, lineSpacing: 5 }).setOrigin(align === 'center' ? .5 : 0, 0);
  }

  panel(x, y, w, h) { return this.add.rectangle(x, y, w, h, this.colors.panel).setStrokeStyle(3, this.colors.border); }

  buildBackground() {
    this.cameras.main.setBackgroundColor('#171024');
    this.add.rectangle(WIDTH / 2, 374, WIDTH, 235, 0x21172e);
    pixelSprite(this, WIDTH / 2, 228, 'shrine-kit', 'arch', 390, .25);
    pixelSprite(this, WIDTH / 2, 414, 'shrine-kit', 'floor-strip', 180, .55);
    pixelSprite(this, WIDTH / 2, 304, 'shrine-kit', 'rune', 132, .34);
    this.text(WIDTH / 2, 22, this.enemyConfig.encounterLabel, 18, '#ffd56a', 'center');
  }

  buildUi() {
    this.intentPanel = this.panel(225, 95, 390, 84); this.intentText = this.text(225, 66, '', 15, '#ffd56a', 'center'); this.intentDetail = this.text(225, 96, '', 11, '#c6b6d8', 'center');
    this.playerName = this.text(38, 290, '수습 기사', 16);
    this.enemyName = this.text(650, 290, '', 16);
    this.playerHpText = this.text(38, 315, '', 12); this.enemyHpText = this.text(650, 315, '', 12);
    this.playerBar = this.add.rectangle(138, 345, 200, 16, this.colors.hp).setStrokeStyle(2, 0xf8f1ff); this.enemyBar = this.add.rectangle(750, 345, 200, 16, this.colors.green).setStrokeStyle(2, 0xf8f1ff);
    this.playerFigure = pixelSprite(this, 145, 225, 'characters', 'novice', 164);
    this.enemyFigure = null;
    this.sealText = this.text(750, 359, '', 11, '#ffd56a', 'center');
    this.phaseText = this.text(450, 170, '', 12, '#ffd56a', 'center');
    this.panel(450, 421, 820, 74); this.logText = this.text(450, 391, '', 12, '#f8f1ff', 'center');
    this.text(78, 465, '리듬', 13, '#ffd56a'); this.rhythmBoxes = [0,1,2].map(i => this.add.rectangle(142 + i * 34, 474, 24, 24, 0x362746).setStrokeStyle(2, this.colors.border));
    this.rhythmText = this.text(212, 465, '', 12, '#c6b6d8');
    this.buttons = {};
    this.buttons.attack = this.makeButton('attack', '공격', 330, 478, 128, 46, 0xb8464f);
    this.buttons.defend = this.makeButton('defend', '방어', 470, 478, 128, 46, 0x477eb5);
    this.buttons.focus = this.makeButton('focus', '집중', 610, 478, 128, 46, 0x6c9b56);
    this.buttons.finisher = this.makeButton('finisher', '결정타', 760, 478, 140, 46, 0xb37c29);
    this.restartButton = this.makeButton('restart', '다시 시작', 450, 555, 160, 42, 0x765199);
    this.restartButton.container.setVisible(false);
  }

  makeButton(key, label, x, y, w, h, color) {
    const bg = this.add.rectangle(0, 0, w, h, color).setStrokeStyle(3, 0xf8f1ff);
    const labelText = this.text(0, -8, label, 13, '#ffffff', 'center').setOrigin(.5, .5);
    const container = this.add.container(x, y, [bg, labelText]).setSize(w, h).setInteractive({ useHandCursor: true });
    container.on('pointerdown', () => key === 'restart' ? this.resetBattle() : this.takeTurn(key));
    container.on('pointerover', () => { if (container.input.enabled) bg.setFillStyle(0xffd56a); });
    container.on('pointerout', () => bg.setFillStyle(color));
    return { container, bg, color };
  }

  resetBattle() {
    if (this.victoryTimer) this.victoryTimer.remove(false);
    this.victoryTimer = null;
    const enemy = this.enemyConfig;
    this.playerHp = this.playerMaxHp = 34;
    this.enemyHp = this.enemyMaxHp = enemy.maxHp;
    this.intentQueue = enemy.intentSequence.map((intentKey) => ENEMY_INTENT_DEFS[intentKey]);
    this.enemyName.setText(enemy.displayName);
    if (this.enemyFigure) this.enemyFigure.destroy();
    this.enemyFigure = pixelSprite(this, enemy.sprite.x, enemy.sprite.y, enemy.sprite.texture, enemy.sprite.frame, enemy.sprite.scale).setFlipX(enemy.sprite.flipX);
    this.rhythm = 0; this.turn = 0; this.over = false;
    this.phase = 1; this.sealBroken = false; this.lastIntentKey = null;
    this.phaseText.setText('');
    if (this.sealRune) this.sealRune.destroy();
    this.sealRune = enemy.boss ? pixelSprite(this, 748, 200, 'shrine-kit', 'rune', 120, .5).setVisible(false) : null;
    this.restartButton.container.setVisible(false); Object.entries(this.buttons).forEach(([key, b]) => { if (key !== 'restart') b.container.setVisible(true); });
    this.log = '예고를 보고 가장 좋은 대응을 골라보세요.'; this.render();
  }

  currentIntent() {
    const intent = this.intentQueue[this.turn % this.intentQueue.length];
    const boss = this.enemyConfig.boss;
    if (!boss) return intent;
    // 공유 정의를 변경하지 않고 현재 단계의 예고를 만든다.
    const damage = intent.key === 'attack' ? boss.attackDamage[this.phase - 1] : intent.key === 'heavy' ? boss.heavyDamage : 0;
    const details = {
      attack: `대검의 일격 · ${damage} 피해 (방어 ${Math.ceil(damage / 2)})`,
      heavy: `${damage} 피해 · 방어하면 2 피해 / 리듬 +2 / 봉인 노출`,
      charge: '공격: 차단 · 리듬 +2 · 봉인 노출\n결정타로는 차단할 수 없습니다.',
      defend: '공격은 3 피해 · 집중은 리듬 +2',
    };
    return { ...intent, damage, detail: details[intent.key] };
  }

  showFloatingText(x, y, value, color, emphatic = false) {
    const popup = this.text(x, y, value, emphatic ? 19 : 15, color, 'center').setDepth(20).setOrigin(.5);
    popup.setStroke('#171024', 4);
    this.tweens.add({ targets: popup, y: y - (emphatic ? 64 : 46), alpha: 0, scaleX: emphatic ? 1.25 : 1, scaleY: emphatic ? 1.25 : 1, duration: emphatic ? 1000 : 800, ease: 'Cubic.Out', onComplete: () => popup.destroy() });
  }

  playEffect(frame, x, y, size = 104, emphatic = false) {
    const effect = pixelSprite(this, x, y, 'combat-effects', frame, size).setDepth(15).setAlpha(.92);
    const baseScale = effect.scaleX;
    this.tweens.add({ targets: effect, alpha: 0, scaleX: baseScale * (emphatic ? 1.45 : 1.25), scaleY: baseScale * (emphatic ? 1.45 : 1.25), duration: emphatic ? 440 : 300, ease: 'Quad.Out', onComplete: () => effect.destroy() });
  }

  flashCombatant(side, color, emphatic = false) {
    const figure = side === 'player' ? this.playerFigure : this.enemyFigure;
    const flash = this.add.rectangle(figure.x, figure.y, 112, 100, color, emphatic ? .8 : .55).setDepth(10);
    this.tweens.add({ targets: flash, alpha: 0, duration: emphatic ? 310 : 190, onComplete: () => flash.destroy() });
    this.tweens.add({ targets: figure, x: figure.x + (side === 'player' ? -8 : 8), duration: emphatic ? 55 : 75, yoyo: true, repeat: emphatic ? 2 : 1 });
  }

  takeTurn(action) {
    if (this.over || !['attack', 'defend', 'focus', 'finisher'].includes(action) || (action === 'finisher' && this.rhythm < 3)) return;
    // 이번 예고와 기존 노출을 고정한다. 단계/다음 노출은 양측 생존 확인 뒤 갱신한다.
    const enemy = this.currentIntent();
    const wasExposed = this.sealBroken;
    const chargeInterrupted = enemy.key === 'charge' && action === 'attack';
    const opensSeal = !!this.enemyConfig.boss && (chargeInterrupted || (enemy.key === 'heavy' && action === 'defend'));
    let lines = [];
    let playerDamage = 0; let rhythmGain = 0; let enemyDamage = 0;
    if (action === 'attack') {
      playerDamage = enemy.key === 'defend' ? 3 : 7;
      if (enemy.key === 'charge') { rhythmGain = 2; lines.push('공격이 힘 모으기를 끊었다! 리듬 +2'); }
      else lines.push(enemy.key === 'defend' ? '방어에 막혀 피해가 줄었다.' : '검격이 적중했다.');
    } else if (action === 'defend') {
      if (enemy.key === 'heavy') { enemyDamage = 2; rhythmGain = 2; lines.push('강공격을 완벽히 막았다! 리듬 +2'); }
      else { enemyDamage = enemy.damage ? Math.ceil(enemy.damage / 2) : 0; lines.push('방어 태세를 갖췄다.'); }
    } else if (action === 'focus') {
      rhythmGain = enemy.key === 'defend' ? 2 : 1; lines.push(enemy.key === 'defend' ? '적이 막는 틈에 집중했다! 리듬 +2' : '호흡을 고른다. 리듬 +1');
    } else if (action === 'finisher') {
      playerDamage = this.enemyConfig.boss && wasExposed ? this.enemyConfig.boss.exposedFinisherDamage : 16;
      this.rhythm = 0; lines.push(playerDamage === 24 ? '봉인 파쇄! 노출 결정타 24 피해!' : '결정타! 방어를 꿰뚫는 일격을 날렸다.');
    }
    this.enemyHp = Math.max(0, this.enemyHp - playerDamage); this.rhythm = Math.min(3, this.rhythm + rhythmGain);
    if (playerDamage) {
      this.flashCombatant('enemy', chargeInterrupted ? 0xffd56a : 0xeb5b67, chargeInterrupted);
      this.playEffect('attack', this.enemyFigure.x, this.enemyFigure.y, chargeInterrupted ? 132 : 106, chargeInterrupted);
      this.showFloatingText(this.enemyFigure.x, this.enemyFigure.y - 58, `-${playerDamage}`, '#ffb1b8', chargeInterrupted);
    }
    if (rhythmGain) {
      this.playEffect('rhythm', 185, 432, rhythmGain === 2 ? 98 : 76, rhythmGain === 2);
      this.showFloatingText(165, 440, `리듬 +${rhythmGain}`, '#ffd56a', rhythmGain === 2);
    }
    if (action === 'defend') this.playEffect('guard', this.playerFigure.x, this.playerFigure.y, enemy.key === 'heavy' ? 132 : 106, enemy.key === 'heavy');
    if (action === 'focus') this.flashCombatant('player', 0x79bf78, rhythmGain === 2);
    if (this.enemyHp <= 0) { this.finish(true, `${lines.join(' ')}\n${this.enemyConfig.logName}을 쓰러뜨렸다!`); return; }
    // 방어가 아닌 행동은 예고된 공격을 그대로 받는다.
    if (action !== 'defend' && enemy.damage) enemyDamage = enemy.damage;
    if (chargeInterrupted) { lines.push('강공격 준비가 취소되었다.'); this.showFloatingText(450, 178, '차단!', '#ffd56a', true); }
    else if (enemy.key === 'charge') lines.push(`${this.enemyConfig.logName}은 다음 턴 강공격을 노린다.`);
    else if (enemy.damage) {
      this.playerHp = Math.max(0, this.playerHp - enemyDamage); lines.push(`${this.enemyConfig.logName}의 ${enemy.name}: ${enemyDamage} 피해`);
      const blockedHeavy = enemy.key === 'heavy' && action === 'defend';
      this.flashCombatant('player', blockedHeavy ? 0x83d6ff : 0xeb5b67, blockedHeavy);
      this.showFloatingText(this.playerFigure.x, this.playerFigure.y - 58, `-${enemyDamage}`, blockedHeavy ? '#9fdcff' : '#ffb1b8', blockedHeavy);
      if (blockedHeavy) this.showFloatingText(450, 178, '완벽 방어!', '#9fdcff', true);
    }
    else if (enemy.key === 'defend') lines.push(`${this.enemyConfig.logName}은 단단히 방어 중이다.`);
    if (this.playerHp <= 0) { this.finish(false, `${lines.join(' ')}\n수습 기사가 쓰러졌다…`); return; }
    // 힘 모으기를 끊었으면 바로 뒤에 있던 강공격 패턴도 함께 건너뛴다.
    const nextIntent = this.intentQueue[(this.turn + 1) % this.intentQueue.length];
    this.turn += chargeInterrupted && nextIntent.key === 'heavy' ? 2 : 1;
    if (this.enemyConfig.boss) {
      // 기존 노출은 이번 유효 행동으로 만료. 이번 행동에서 새로 연 봉인만 다음 턴에 남긴다.
      this.sealBroken = opensSeal;
      if (opensSeal) {
        lines[0] += ' · 봉인이 열렸다!';
        this.showFloatingText(748, 160, '봉인이 열렸다!', '#ffd56a', true);
      }
      if (this.phase === 1 && this.enemyHp <= this.enemyConfig.boss.phaseThreshold) {
        this.phase = 2;
        this.phaseText.setText('심장석 균열\n다음 일반 공격부터 7 피해');
        this.enemyFigure.setTint(0xffd5a0);
        this.playEffect('rhythm', 748, 200, 150, true);
      }
    }
    this.log = lines.join('\n'); this.render();
  }

  finish(won, message) {
    if (this.over) return;
    this.over = true;
    this.log = message;
    Object.values(this.buttons).forEach(b => { b.container.input.enabled = false; });
    if (won) {
      this.sealBroken = false;
      this.render();
      if (this.enemyConfig.boss) {
        this.log = '봉인이 풀리며 심장석의 빛이 고르게 번진다.';
        this.render();
        this.playEffect('rhythm', this.enemyFigure.x, this.enemyFigure.y, 250, true);
        this.tweens.add({ targets: this.enemyFigure, alpha: 0, duration: 800 });
        this.victoryTimer = this.time.delayedCall(800, () => {
          this.victoryTimer = null;
          this.advanceAfterVictory();
        });
        return;
      }
      this.advanceAfterVictory();
      return;
    }
    Object.values(this.buttons).forEach(b => b.container.setVisible(false));
    this.restartButton.container.setVisible(true); this.render();
  }

  advanceAfterVictory() {
    const nextIndex = this.enemyIndex + 1;
    const hasNextBattle = nextIndex < this.battleOrder.length;
    if (hasNextBattle) {
      this.registry.set('defeatedEnemyId', this.enemyConfig.id);
      this.registry.set('battleIndex', nextIndex);
      this.scene.start('battleTransition');
      return;
    }
    this.registry.set('battleIndex', 0);
    this.scene.start('ending');
  }

  render() {
    const enemy = this.currentIntent();
    const intentColors = { attack: '#ff929b', heavy: '#ffad64', defend: '#8ec5ff', charge: '#d898ff' };
    const intentColor = intentColors[enemy.key] || '#ffd56a';
    this.intentText.setText(this.over ? (this.enemyHp <= 0 ? '승리!' : '패배…') : `다음 행동 예고: ${enemy.name}`).setColor(intentColor); this.intentDetail.setText(this.over ? (this.enemyHp <= 0 ? '심장석의 봉인이 풀립니다.' : '다시 시작해 전투를 반복할 수 있습니다.') : enemy.detail);
    this.intentPanel.setStrokeStyle(enemy.key === 'heavy' ? 5 : 3, Phaser.Display.Color.HexStringToColor(intentColor).color);
    if (!this.over && this.lastIntentKey !== enemy.key) {
      this.lastIntentKey = enemy.key;
      this.tweens.add({ targets: [this.intentText, this.intentDetail], scaleX: enemy.key === 'heavy' || enemy.key === 'charge' ? 1.1 : 1.05, scaleY: enemy.key === 'heavy' || enemy.key === 'charge' ? 1.1 : 1.05, duration: 130, yoyo: true, ease: 'Quad.Out' });
    }
    this.playerHpText.setText(`HP ${this.playerHp} / ${this.playerMaxHp}`); this.enemyHpText.setText(`HP ${this.enemyHp} / ${this.enemyMaxHp}`);
    this.playerBar.displayWidth = 200 * this.playerHp / this.playerMaxHp; this.enemyBar.displayWidth = 200 * this.enemyHp / this.enemyMaxHp;
    this.playerBar.x = 38 + this.playerBar.displayWidth / 2; this.enemyBar.x = 650 + this.enemyBar.displayWidth / 2;
    this.rhythmBoxes.forEach((box, i) => box.setFillStyle(i < this.rhythm ? this.colors.gold : 0x362746)); this.rhythmText.setText(`${this.rhythm} / 3`);
    Object.values(this.buttons).forEach(b => { b.container.input.enabled = !this.over; });
    const finisher = this.buttons.finisher; const ready = this.rhythm === 3 && !this.over; finisher.container.input.enabled = ready; finisher.container.setAlpha(ready ? 1 : .35); finisher.bg.setFillStyle(finisher.color);
    this.sealText.setVisible(!!this.enemyConfig.boss && !this.over).setText(this.sealBroken ? '봉인 노출 · 이번 행동까지\n결정타 24 피해' : '봉인 닫힘 · 결정타 16 피해');
    if (this.sealRune) this.sealRune.setVisible(this.sealBroken && !this.over);
    this.logText.setText(this.log);
  }
}

class EndingScene extends Phaser.Scene {
  constructor() { super('ending'); }

  create() {
    this.cameras.main.setBackgroundColor('#171024');
    this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x171024);
    pixelSprite(this, WIDTH / 2, 242, 'shrine-kit', 'arch', 420, .34);
    pixelSprite(this, WIDTH / 2, 480, 'shrine-kit', 'floor-strip', 145, .65);
    pixelSprite(this, 450, 184, 'shrine-kit', 'rune', 172, .9);
    pixelSprite(this, 245, 410, 'characters', 'novice', 150, .92);
    this.add.text(WIDTH / 2, 106, '성소의 봉인을 복구했다', { fontFamily: 'monospace', fontSize: '18px', fontStyle: 'bold', color: '#ffd56a' }).setOrigin(.5);
    this.add.rectangle(WIDTH / 2, 345, 680, 150, 0x2a1d3b).setStrokeStyle(3, 0x9d7bbf);
    this.add.text(WIDTH / 2, 302, '심장석의 박동이 고르게 돌아온다.', { fontFamily: 'monospace', fontSize: '17px', fontStyle: 'bold', color: '#f8f1ff' }).setOrigin(.5);
    this.add.text(WIDTH / 2, 347, '수습 기사는 심장석을 제자리에 고정하고\n성소의 봉인을 복구했다.', { fontFamily: 'monospace', fontSize: '14px', color: '#c6b6d8', align: 'center', lineSpacing: 8 }).setOrigin(.5);
    this.makeButton('처음부터 다시', 450, 500, 220, 50, 0x765199, () => this.scene.start('intro'));
  }

  makeButton(label, x, y, w, h, color, callback) {
    const bg = this.add.rectangle(0, 0, w, h, color).setStrokeStyle(3, 0xf8f1ff);
    const text = this.add.text(0, 0, label, { fontFamily: 'monospace', fontSize: '15px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(.5);
    const button = this.add.container(x, y, [bg, text]).setSize(w, h).setInteractive({ useHandCursor: true });
    button.on('pointerover', () => bg.setFillStyle(0xffd56a));
    button.on('pointerout', () => bg.setFillStyle(color));
    button.on('pointerdown', callback);
  }
}

class BattleTransitionScene extends Phaser.Scene {
  constructor() { super('battleTransition'); }

  create() {
    const nextIndex = this.registry.get('battleIndex') || 1;
    const battleOrder = this.registry.get('battleOrder') || ENEMY_ORDER;
    const currentEnemyId = this.registry.get('defeatedEnemyId');
    const currentEnemy = ENEMY_PRESETS[currentEnemyId] || {};
    const nextEnemyId = battleOrder[nextIndex];
    const nextEnemy = ENEMY_PRESETS[nextEnemyId];

    this.cameras.main.setBackgroundColor('#171024');
    this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x171024);
    this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, 240, 0x2a1d3b).setStrokeStyle(3, 0x9d7bbf);
    this.add.text(WIDTH / 2, 130, '적 조우 완료', { fontFamily: 'monospace', fontSize: '28px', fontStyle: 'bold', color: '#ffd56a' }).setOrigin(.5);
    const defeatedName = (currentEnemy && currentEnemy.displayName) || '적';
    const nextEnemyName = (nextEnemy && nextEnemy.displayName) || '다음 적';
    this.add.text(WIDTH / 2, 195, `${defeatedName}을 쓰러뜨렸다.`, { fontFamily: 'monospace', fontSize: '17px', color: '#f8f1ff' }).setOrigin(.5);
    this.add.text(WIDTH / 2, 225, `${nextEnemyName}가 봉인문으로 나아온다.`, { fontFamily: 'monospace', fontSize: '17px', color: '#c6b6d8', align: 'center' }).setOrigin(.5);
    this.add.text(WIDTH / 2, 269, '전투 준비: HP 34로 회복 · 리듬 0으로 시작', { fontFamily: 'monospace', fontSize: '14px', color: '#ffd56a' }).setOrigin(.5);
    if (nextEnemy.boss) {
      this.add.text(WIDTH / 2, 311, '힘 모으기는 공격으로 끊고, 강공격은 방어로 버티세요.\n열린 봉인에 다음 행동으로 결정타를 넣으면 24 피해를 줍니다.', { fontFamily: 'monospace', fontSize: '14px', color: '#f8f1ff', align: 'center', lineSpacing: 8 }).setOrigin(.5);
    }
    this.makeButton(nextEnemy.boss ? '심판관과 전투' : '다음 적과 전투', WIDTH / 2, 390, 240, 52, 0x6c9b56, () => this.scene.start('battle'));
    this.makeButton('처음부터 다시', WIDTH / 2, 480, 230, 48, 0x765199, () => {
      this.registry.set('battleIndex', 0);
      this.scene.start('intro');
    });
  }

  makeButton(label, x, y, w, h, color, callback) {
    const bg = this.add.rectangle(0, 0, w, h, color).setStrokeStyle(3, 0xf8f1ff);
    const text = this.add.text(0, 0, label, { fontFamily: 'monospace', fontSize: '15px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(.5);
    const button = this.add.container(x, y, [bg, text]).setSize(w, h).setInteractive({ useHandCursor: true });
    button.on('pointerover', () => bg.setFillStyle(0xffd56a));
    button.on('pointerout', () => bg.setFillStyle(color));
    button.on('pointerdown', callback);
  }
}

const game = new Phaser.Game({ type: Phaser.AUTO, width: WIDTH, height: HEIGHT, parent: 'game', backgroundColor: '#171024', scene: [BootScene, IntroScene, BattleScene, BattleTransitionScene, EndingScene], render: { antialias: false, pixelArt: true }, scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH } });
window.__battleGame = game;
