/* Phaser를 CDN으로만 불러오는, 설치 없는 전투 프로토타입입니다. */
const WIDTH = 900;
const HEIGHT = 620;
const UI_FONT = '"Pretendard", "Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

// 외부 음원 없이 짧은 합성 효과음만 재생한다. 자동 재생 제한·미지원 환경은 조용히 무시한다.
class AudioDirector {
  constructor() {
    this.context = null;
    this.muted = false;
    this.activeSources = new Set();
  }

  activate() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    try {
      if (!this.context || this.context.state === 'closed') this.context = new AudioContext();
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    } catch (_) {
      // 보안 정책 또는 기기 문제로 컨텍스트 생성에 실패해도 게임은 무음으로 계속한다.
    }
  }

  toggle() {
    this.muted = !this.muted;
    if (this.muted) this.stopAll();
    if (!this.muted) this.activate();
    return this.muted;
  }

  tone(frequency, duration = .08, type = 'square', volume = .028, delay = 0, slideTo = null) {
    const context = this.context;
    if (this.muted || !context || context.state !== 'running') return;
    try {
      const start = context.currentTime + delay;
      const end = start + duration;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), end);
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(.012, duration / 3));
      gain.gain.exponentialRampToValueAtTime(.0001, end);
      oscillator.connect(gain).connect(context.destination);
      this.activeSources.add(oscillator);
      oscillator.onended = () => this.activeSources.delete(oscillator);
      oscillator.start(start);
      oscillator.stop(end + .015);
    } catch (_) {
      // 브라우저가 오디오 노드 생성을 막아도 전투 입력과 상태 갱신은 계속한다.
    }
  }

  play(name) {
    const sounds = {
      button: () => this.tone(520, .045, 'square', .018, 0, 640),
      attack: () => { this.tone(180, .07, 'sawtooth', .025, 0, 480); this.tone(740, .045, 'square', .016, .035, 520); },
      enemyAttack: () => this.tone(150, .09, 'sawtooth', .024, 0, 85),
      hit: () => this.tone(105, .075, 'square', .022, 0, 65),
      defend: () => { this.tone(430, .07, 'triangle', .024); this.tone(640, .06, 'triangle', .018, .055); },
      focus: () => { this.tone(330, .06, 'sine', .018); this.tone(495, .09, 'sine', .017, .06); },
      rhythm: () => { this.tone(660, .045, 'triangle', .02); this.tone(880, .065, 'triangle', .018, .06); },
      charge: () => { this.tone(170, .13, 'sawtooth', .02, 0, 300); this.tone(250, .1, 'sawtooth', .014, .08, 410); },
      heavy: () => { this.tone(92, .17, 'sawtooth', .03, 0, 54); this.tone(55, .12, 'square', .018, .07); },
      interrupt: () => { this.tone(780, .07, 'square', .026); this.tone(1170, .12, 'triangle', .021, .06); },
      finisher: () => { this.tone(220, .1, 'sawtooth', .025, 0, 930); this.tone(880, .13, 'square', .03, .07, 1320); this.tone(1320, .16, 'triangle', .022, .15); },
      seal: () => { this.tone(610, .09, 'sine', .022); this.tone(915, .13, 'triangle', .02, .07); },
      phase: () => { this.tone(260, .14, 'sawtooth', .022, 0, 510); this.tone(1020, .15, 'triangle', .022, .1, 1320); },
      victory: () => { this.tone(523, .08, 'triangle', .022); this.tone(659, .1, 'triangle', .022, .09); this.tone(784, .18, 'triangle', .024, .2); },
    };
    if (sounds[name]) sounds[name]();
  }

  stopAll() {
    this.activeSources.forEach((source) => {
      try { source.stop(); } catch (_) { /* 이미 종료된 노드 */ }
    });
    this.activeSources.clear();
  }
}

const audio = new AudioDirector();

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
    // 원본 고블린은 왼쪽을 향한다. 오른쪽에 배치하므로 뒤집지 않아야 기사와 마주 본다.
    sprite: { texture: 'goblin-combat-sheet', frame: 'idle-0', x: 755, y: 254, scale: 164, flipX: false },
    combatSheet: true, combatAnimKey: 'goblin',
    // 튜토리얼은 화면에 순서를 노출하지 않는 공격→방어 고정 반복이다.
    intentSequence: ['attack', 'defend'],
    encounterLabel: '고블린 정찰병과 조우했다',
  },
  skeleton: {
    id: 'skeleton',
    displayName: '해골 성소지기',
    logName: '해골 성소지기',
    maxHp: 48,
    sprite: { texture: 'skeleton-combat-sheet', frame: 'idle-0', x: 760, y: 254, scale: 164, flipX: false },
    combatSheet: true, combatAnimKey: 'skeleton',
    intentSequence: ['attack', 'attack', 'defend'],
    encounterLabel: '해골 성소지기와 조우했다',
  },
  kobold: {
    id: 'kobold',
    displayName: '코볼트 주술사',
    logName: '코볼트 주술사',
    maxHp: 52,
    sprite: { texture: 'kobold-shaman-combat-sheet', frame: 'idle-0', x: 758, y: 254, scale: 164, flipX: false },
    combatSheet: true, combatAnimKey: 'kobold',
    // 세 번째 성공한 힘 모으기 뒤의 공격 칸만 강공격으로 바뀐다.
    intentSequence: ['defend', 'charge', 'attack'],
    encounterLabel: '코볼트 주술사가 룬 지팡이를 들어 올린다',
  },
  orc: {
    id: 'orc',
    displayName: '오크 파수꾼',
    logName: '오크 파수꾼',
    maxHp: 56,
    sprite: { texture: 'orc-sentinel-combat-sheet', frame: 'idle-0', x: 758, y: 254, scale: 178, flipX: false },
    combatSheet: true, combatAnimKey: 'orc',
    // 공격 칸은 적 리듬이 3일 때만 강공격으로 바뀐다.
    intentSequence: ['attack', 'defend', 'attack', 'charge'],
    encounterLabel: '오크 파수꾼이 방패 뒤에서 도끼를 고쳐 쥔다',
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

const ENEMY_ORDER = ['goblin', 'skeleton', 'kobold', 'orc', 'arbiter'];

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
    this.load.image('novice-combat-sheet', 'assets/novice-combat-sheet.png');
    this.load.image('skeleton-combat-sheet', 'assets/skeleton-shrine-keeper-combat-sheet.png');
    this.load.image('goblin-combat-sheet', 'assets/goblin-combat-sheet.png');
    this.load.image('kobold-shaman-combat-sheet', 'assets/kobold-shaman-combat-sheet.png');
    this.load.image('orc-sentinel-combat-sheet', 'assets/orc-sentinel-combat-sheet.png');
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

    const noviceCombat = this.textures.get('novice-combat-sheet');
    ['idle', 'attack', 'guard', 'focus', 'hurt', 'heavy', 'down'].forEach((row, rowIndex) => {
      for (let column = 0; column < 4; column++) {
        noviceCombat.add(`${row}-${column}`, 0, column * 280, rowIndex * 280, 280, 280);
      }
      this.anims.create({
        key: `novice-${row}`,
        // 다운은 쓰러짐·회복 프레임을 왕복해 쓰러진 뒤에도 생동감을 남긴다.
        frames: (row === 'down' ? [0, 1, 2, 3, 2, 1] : [0, 1, 2, 3]).map(column => ({ key: 'novice-combat-sheet', frame: `${row}-${column}` })),
        frameRate: row === 'down' ? 3 : (row === 'attack' || row === 'hurt' ? 12 : 9),
        repeat: row === 'idle' || row === 'down' ? -1 : 0,
      });
    });
    const goblinCombat = this.textures.get('goblin-combat-sheet');
    ['idle', 'attack', 'guard', 'hurt'].forEach((row, rowIndex) => {
      for (let column = 0; column < 4; column++) goblinCombat.add(`${row}-${column}`, 0, column * 280, rowIndex * 280, 280, 280);
      this.anims.create({ key: `goblin-${row}`, frames: [0, 1, 2, 3].map(column => ({ key: 'goblin-combat-sheet', frame: `${row}-${column}` })), frameRate: row === 'attack' || row === 'hurt' ? 12 : 9, repeat: row === 'idle' ? -1 : 0 });
    });
    const skeletonCombat = this.textures.get('skeleton-combat-sheet');
    ['idle', 'attack', 'guard', 'hurt'].forEach((row, rowIndex) => {
      for (let column = 0; column < 4; column++) skeletonCombat.add(`${row}-${column}`, 0, column * 280, rowIndex * 280, 280, 280);
      this.anims.create({
        key: `skeleton-${row}`,
        frames: [0, 1, 2, 3].map(column => ({ key: 'skeleton-combat-sheet', frame: `${row}-${column}` })),
        frameRate: row === 'attack' || row === 'hurt' ? 12 : 9,
        repeat: row === 'idle' ? -1 : 0,
      });
    });
    [['kobold', 'kobold-shaman-combat-sheet'], ['orc', 'orc-sentinel-combat-sheet']].forEach(([enemyId, textureKey]) => {
      const combatTexture = this.textures.get(textureKey);
      ['idle', 'attack', 'guard', 'charge', 'hurt'].forEach((row, rowIndex) => {
        for (let column = 0; column < 4; column++) combatTexture.add(`${row}-${column}`, 0, column * 280, rowIndex * 280, 280, 280);
        this.anims.create({
          key: `${enemyId}-${row}`,
          frames: [0, 1, 2, 3].map(column => ({ key: textureKey, frame: `${row}-${column}` })),
          frameRate: row === 'attack' || row === 'hurt' ? 12 : 9,
          repeat: row === 'idle' ? -1 : 0,
        });
      });
    });
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
    this.add.text(WIDTH / 2, 82, '봉인의 박자', { fontFamily: UI_FONT, fontSize: '36px', fontStyle: 'bold', color: '#ffd56a' }).setOrigin(.5);
    this.add.text(WIDTH / 2, 142, '성소 입구', { fontFamily: UI_FONT, fontSize: '19px', fontStyle: 'bold', color: '#f8f1ff' }).setOrigin(.5);
    this.add.rectangle(WIDTH / 2, 286, 660, 172, 0x2a1d3b).setStrokeStyle(3, 0x9d7bbf);
    this.add.text(WIDTH / 2, 220, '성벽 아래 오래된 성소의 봉인이 흔들린다.', { fontFamily: UI_FONT, fontSize: '16px', color: '#f8f1ff' }).setOrigin(.5);
    this.add.text(WIDTH / 2, 258, '수습 기사는 박동에 동조하는 검을 들고\n정찰 중인 고블린을 지나 안으로 향한다.', { fontFamily: UI_FONT, fontSize: '15px', color: '#c6b6d8', align: 'center', lineSpacing: 9 }).setOrigin(.5);
    this.add.text(WIDTH / 2, 410, '적의 예고를 읽고 리듬을 쌓으세요.', { fontFamily: UI_FONT, fontSize: '14px', fontStyle: 'bold', color: '#ffd56a' }).setOrigin(.5);
    this.makeButton('성소 안으로', 450, 500, 220, 50, 0x765199, () => {
      this.registry.set('battleOrder', ENEMY_ORDER);
      this.registry.set('battleIndex', 0);
      this.registry.set('carriedPlayerHp', null);
      this.scene.start('battle');
    });
  }

  makeButton(label, x, y, w, h, color, callback) {
    const bg = this.add.rectangle(0, 0, w, h, color).setStrokeStyle(3, 0xf8f1ff);
    const text = this.add.text(0, 0, label, { fontFamily: UI_FONT, fontSize: '15px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(.5);
    const button = this.add.container(x, y, [bg, text]).setSize(w, h).setInteractive({ useHandCursor: true });
    button.on('pointerover', () => bg.setFillStyle(0xffd56a));
    button.on('pointerout', () => bg.setFillStyle(color));
    button.on('pointerdown', () => { audio.activate(); audio.play('button'); callback(); });
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
    this.events.once('shutdown', () => { this.stopDownMotion(); audio.stopAll(); });
  }

  text(x, y, value, size = 14, color = '#f8f1ff', align = 'left') {
    return this.add.text(x, y, value, { fontFamily: UI_FONT, fontSize: `${size}px`, fontStyle: 'bold', color, align, lineSpacing: 6 }).setOrigin(align === 'center' ? .5 : 0, 0);
  }

  panel(x, y, w, h) { return this.add.rectangle(x, y, w, h, this.colors.panel).setStrokeStyle(3, this.colors.border); }

  isTutorial() { return this.enemyConfig.id === 'goblin'; }

  isPatternEnemy() { return !this.enemyConfig.boss; }

  setPlayerPose(pose, hold = false) {
    if (!this.playerFigure?.active) return;
    // 전투 시트는 왼쪽 원본 방향이다. 어떤 행동 프레임으로 바뀌어도
    // 좌측 기사는 항상 오른쪽의 적을 바라보게 고정한다.
    this.playerFigure.setFlipX(true);
    if (pose === 'down') this.startDownMotion();
    else this.stopDownMotion();
    this.playerFigure.play(`novice-${pose}`, true);
    if (!hold && pose !== 'idle') {
      this.playerFigure.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        if (!this.over && !this.isDown()) this.playerFigure.play('novice-idle', true);
      });
    }
  }

  startDownMotion() {
    if (this.downMotion || !this.playerFigure?.active) return;
    this.downRestingY = this.playerFigure.y;
    this.downMotion = this.tweens.add({
      targets: this.playerFigure,
      y: this.downRestingY + 3,
      angle: -2,
      duration: 480,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });
  }

  stopDownMotion() {
    if (!this.downMotion) return;
    this.downMotion.stop();
    this.downMotion = null;
    if (this.playerFigure?.active) this.playerFigure.setY(this.downRestingY ?? this.playerFigure.y).setAngle(0);
    this.downRestingY = null;
  }

  setEnemyPose(pose, hold = false) {
    if (!this.enemyConfig.combatSheet || !this.enemyFigure?.active) return;
    const prefix = this.enemyConfig.combatAnimKey;
    this.enemyFigure.play(`${prefix}-${pose}`, true);
    if (!hold && pose !== 'idle') {
      this.enemyFigure.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        if (!this.over && this.enemyFigure?.active) this.enemyFigure.play(`${prefix}-idle`, true);
      });
    }
  }

  isDown() { return this.isPatternEnemy() && this.downTurns > 0; }

  clearResolutionTimers() {
    (this.resolutionTimers || []).forEach(timer => timer.remove(false));
    this.resolutionTimers = [];
  }

  scheduleResolution(delay, callback) {
    const timer = this.time.delayedCall(delay, () => {
      this.resolutionTimers = this.resolutionTimers.filter(item => item !== timer);
      callback();
    });
    this.resolutionTimers.push(timer);
    return timer;
  }

  buildBackground() {
    this.cameras.main.setBackgroundColor('#171024');
    this.add.rectangle(WIDTH / 2, 374, WIDTH, 235, 0x21172e);
    pixelSprite(this, WIDTH / 2, 228, 'shrine-kit', 'arch', 390, .25);
    pixelSprite(this, WIDTH / 2, 414, 'shrine-kit', 'floor-strip', 180, .55);
    pixelSprite(this, WIDTH / 2, 304, 'shrine-kit', 'rune', 132, .34);
    this.text(WIDTH / 2, 22, this.enemyConfig.encounterLabel, 18, '#ffd56a', 'center');
  }

  buildUi() {
    this.intentPanel = this.panel(225, 95, 410, 88); this.intentText = this.text(225, 64, '', 17, '#ffd56a', 'center'); this.intentDetail = this.text(225, 98, '', 12, '#c6b6d8', 'center');
    this.playerName = this.text(38, 290, '수습 기사', 16);
    this.enemyName = this.text(650, 290, '', 16);
    this.playerHpText = this.text(38, 315, '', 12); this.enemyHpText = this.text(650, 315, '', 12);
    this.playerBar = this.add.rectangle(138, 345, 200, 16, this.colors.hp).setStrokeStyle(2, 0xf8f1ff); this.enemyBar = this.add.rectangle(750, 345, 200, 16, this.colors.green).setStrokeStyle(2, 0xf8f1ff);
    this.hpBarTweens = { player: null, enemy: null };
    // 전투 시트 원본은 왼쪽을 향한다. 좌측의 기사는 뒤집어 오른쪽 적을 향한다.
    this.playerFigure = this.add.sprite(145, 225, 'novice-combat-sheet', 'idle-0').setScale(164 / 280).setFlipX(true).play('novice-idle');
    this.enemyFigure = null;
    this.sealText = this.text(750, 359, '', 11, '#ffd56a', 'center');
    this.phaseText = this.text(450, 170, '', 12, '#ffd56a', 'center');
    this.downText = this.text(145, 365, '', 11, '#ffad64', 'center');
    this.panel(450, 421, 820, 74); this.logText = this.text(450, 390, '', 13, '#f8f1ff', 'center').setWordWrapWidth(780);
    this.text(78, 465, '리듬', 14, '#ffd56a'); this.rhythmBoxes = [0,1,2].map(i => this.add.rectangle(142 + i * 34, 474, 24, 24, 0x362746).setStrokeStyle(2, this.colors.border));
    this.rhythmText = this.text(212, 465, '', 12, '#c6b6d8');
    this.buttons = {};
    this.buttons.attack = this.makeButton('attack', '공격', 330, 478, 128, 46, 0xb8464f);
    this.buttons.defend = this.makeButton('defend', '방어', 470, 478, 128, 46, 0x477eb5);
    this.buttons.focus = this.makeButton('focus', '집중', 610, 478, 128, 46, 0x6c9b56);
    this.buttons.finisher = this.makeButton('finisher', '강공격', 760, 478, 140, 46, 0xb37c29);
    this.restartButton = this.makeButton('restart', '다시 시작', 450, 555, 160, 42, 0x765199);
    this.soundButton = this.makeSoundButton();
    this.restartButton.container.setVisible(false);
  }

  makeSoundButton() {
    const bg = this.add.rectangle(0, 0, 92, 28, 0x3b2b50).setStrokeStyle(2, 0xa98bc2);
    const label = this.text(0, -7, '', 11, '#f8f1ff', 'center').setOrigin(.5, .5);
    const container = this.add.container(842, 38, [bg, label]).setSize(92, 28).setInteractive({ useHandCursor: true });
    const refresh = () => {
      const muted = audio.muted;
      label.setText(muted ? '소리: 끔' : '소리: 켬').setColor(muted ? '#c6b6d8' : '#ffd56a');
      bg.setFillStyle(muted ? 0x362746 : 0x3b2b50);
    };
    container.on('pointerdown', () => { audio.activate(); audio.toggle(); refresh(); });
    container.on('pointerover', () => bg.setStrokeStyle(2, 0xffd56a));
    container.on('pointerout', () => bg.setStrokeStyle(2, 0xa98bc2));
    refresh();
    return {
      container,
      refresh,
      status: () => ({ muted: audio.muted, supported: !!(window.AudioContext || window.webkitAudioContext), activeSources: audio.activeSources.size }),
    };
  }

  makeButton(key, label, x, y, w, h, color) {
    const bg = this.add.rectangle(0, 0, w, h, color).setStrokeStyle(3, 0xf8f1ff);
    const labelText = this.text(0, -8, label, 13, '#ffffff', 'center').setOrigin(.5, .5);
    const container = this.add.container(x, y, [bg, labelText]).setSize(w, h).setInteractive({ useHandCursor: true });
    container.on('pointerdown', () => {
      audio.activate();
      if (key === 'restart') { audio.play('button'); this.resetBattle(); }
      else if (!this.inputLocked) { audio.play('button'); this.takeTurn(key, true); }
    });
    container.on('pointerover', () => { if (container.input.enabled) bg.setFillStyle(0xffd56a); });
    container.on('pointerout', () => bg.setFillStyle(color));
    return { container, bg, color };
  }

  resetBattle() {
    audio.stopAll();
    if (this.victoryTimer) this.victoryTimer.remove(false);
    if (this.actionUnlockTimer) this.actionUnlockTimer.remove(false);
    this.clearResolutionTimers();
    this.victoryTimer = null;
    this.actionUnlockTimer = null;
    this.inputLocked = false;
    this.resolutionPhase = 'idle';
    const enemy = this.enemyConfig;
    this.playerMaxHp = 34;
    const carriedPlayerHp = this.registry.get('carriedPlayerHp');
    this.playerHp = typeof carriedPlayerHp === 'number' ? Math.min(this.playerMaxHp, carriedPlayerHp) : this.playerMaxHp;
    this.registry.set('carriedPlayerHp', null);
    this.enemyHp = this.enemyMaxHp = enemy.maxHp;
    Object.values(this.hpBarTweens || {}).forEach(tween => tween?.stop());
    this.hpBarTweens = { player: null, enemy: null };
    this.intentQueue = enemy.intentSequence.map((intentKey) => ENEMY_INTENT_DEFS[intentKey]);
    this.enemyName.setText(enemy.displayName);
    if (this.enemyFigure) this.enemyFigure.destroy();
    this.enemyFigure = enemy.combatSheet
      ? this.add.sprite(enemy.sprite.x, enemy.sprite.y, enemy.sprite.texture, enemy.sprite.frame).setOrigin(.5, .9286).setScale(enemy.sprite.scale / 280).setFlipX(enemy.sprite.flipX).play(`${enemy.combatAnimKey}-idle`)
      : pixelSprite(this, enemy.sprite.x, enemy.sprite.y, enemy.sprite.texture, enemy.sprite.frame, enemy.sprite.scale).setFlipX(enemy.sprite.flipX);
    this.goblinBasePose = enemy.id === 'goblin'
      ? { x: this.enemyFigure.x, y: this.enemyFigure.y, scaleX: this.enemyFigure.scaleX, scaleY: this.enemyFigure.scaleY, angle: this.enemyFigure.angle }
      : null;
    this.rhythm = 0; this.enemyRhythm = 0; this.turn = 0; this.over = false;
    this.downTurns = 0;
    this.phase = 1; this.sealBroken = false; this.lastIntentKey = null;
    this.phaseText.setText('');
    if (this.sealRune) this.sealRune.destroy();
    this.sealRune = enemy.boss ? pixelSprite(this, 748, 200, 'shrine-kit', 'rune', 120, .5).setVisible(false) : null;
    this.restartButton.container.setVisible(false); Object.entries(this.buttons).forEach(([key, b]) => { if (key !== 'restart') b.container.setVisible(true); });
    this.setPlayerPose('idle', true);
    this.log = '예고를 읽고 행동을 고르세요.'; this.render(true);
  }

  currentIntent() {
    const intent = this.intentQueue[this.turn % this.intentQueue.length];
    const boss = this.enemyConfig.boss;
    if (!boss) {
      // 일반 적의 고정 패턴에는 강공격 칸을 두지 않는다. 적 리듬 3일 때만
      // 다음 공격 칸을 강공격으로 대체하고, 실제 사용 뒤에는 0으로 비운다.
      if (intent.key === 'attack' && this.enemyRhythm === 3) {
        return { ...ENEMY_INTENT_DEFS.heavy, detail: '완성된 힘을 거칠게 내려찍습니다!' };
      }
      return intent;
    }
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

  playEffect(frame, x, y, size = 104, emphatic = false, duration = emphatic ? 440 : 300, depth = 15) {
    const effect = pixelSprite(this, x, y, 'combat-effects', frame, size).setOrigin(.5).setDepth(depth).setAlpha(.92);
    const baseScale = effect.scaleX;
    this.tweens.add({ targets: effect, alpha: 0, scaleX: baseScale * (emphatic ? 1.45 : 1.25), scaleY: baseScale * (emphatic ? 1.45 : 1.25), duration, ease: 'Quad.Out', onComplete: () => effect.destroy() });
  }

  flashCombatant(side, color, emphatic = false, knockback = true) {
    const figure = side === 'player' ? this.playerFigure : this.enemyFigure;
    // 이전의 반투명 사각형은 프레임 위에 빨강/파랑 배경 잔상처럼 보였다.
    // 캐릭터 픽셀만 짧게 틴트해 피격·방어를 구분한다.
    figure.setTint(color);
    this.time.delayedCall(emphatic ? 280 : 180, () => {
      if (figure?.active) figure.clearTint();
    });
    if (knockback) this.tweens.add({ targets: figure, x: figure.x + (side === 'player' ? -8 : 8), duration: emphatic ? 55 : 75, yoyo: true, repeat: emphatic ? 2 : 1 });
  }

  showGuard(side, emphatic = false) {
    const figure = side === 'player' ? this.playerFigure : this.enemyFigure;
    const compactGoblinGuard = side === 'enemy' && this.enemyConfig.id === 'goblin';
    figure.setTint(0x83d6ff);
    this.time.delayedCall(emphatic ? 520 : 440, () => {
      if (figure?.active) figure.clearTint();
    });
    this.playEffect('guard', figure.x, figure.y, compactGoblinGuard ? (emphatic ? 94 : 80) : (emphatic ? 128 : 112), emphatic, emphatic ? 620 : 520, compactGoblinGuard ? 5 : 15);
    audio.play('defend');
  }

  animateGoblinGuard(impact = false) {
    if (this.enemyConfig.id !== 'goblin' || !this.enemyFigure?.active) return;
    const figure = this.enemyFigure;
    const base = this.goblinBasePose || { x: figure.x, y: figure.y, scaleX: figure.scaleX, scaleY: figure.scaleY, angle: 0 };
    this.tweens.killTweensOf(figure);
    if (!impact) {
      figure.setPosition(base.x, base.y).setScale(base.scaleX, base.scaleY).setAngle(0);
      this.tweens.add({ targets: figure, x: base.x - 13, y: base.y + 3, angle: -10, scaleX: base.scaleX * 1.06, scaleY: base.scaleY * .95, duration: 220, ease: 'Cubic.Out' });
      return;
    }
    this.tweens.add({ targets: figure, x: base.x - 18, y: base.y + 5, angle: -14, duration: 80, yoyo: true, hold: 100, ease: 'Quad.Out' });
  }

  animateGuardParry(side) {
    const figure = side === 'player' ? this.playerFigure : this.enemyFigure;
    if (!figure?.active) return;
    if (side === 'enemy' && this.enemyConfig.id === 'goblin') {
      this.animateGoblinGuard(true);
      return;
    }
    const baseX = figure.x;
    const baseY = figure.y;
    const baseAngle = figure.angle;
    const shift = side === 'player' ? 7 : -7;
    this.tweens.add({
      targets: figure,
      x: baseX + shift,
      y: baseY + 2,
      angle: baseAngle + (side === 'player' ? 7 : -7),
      duration: 70,
      yoyo: true,
      hold: 100,
      ease: 'Quad.Out',
      onComplete: () => { if (figure?.active) figure.setPosition(baseX, baseY).setAngle(baseAngle); },
    });
  }

  resetGoblinPose() {
    if (this.enemyConfig.id !== 'goblin' || !this.enemyFigure?.active || !this.goblinBasePose) return;
    this.tweens.killTweensOf(this.enemyFigure);
    const base = this.goblinBasePose;
    this.enemyFigure.setPosition(base.x, base.y).setScale(base.scaleX, base.scaleY).setAngle(base.angle);
  }

  animateLunge(side, emphatic = false) {
    const figure = side === 'player' ? this.playerFigure : this.enemyFigure;
    const distance = (side === 'player' ? 1 : -1) * (emphatic ? 38 : 24);
    this.tweens.add({
      targets: figure,
      x: figure.x + distance,
      duration: emphatic ? 145 : 150,
      yoyo: true,
      hold: emphatic ? 100 : 80,
      ease: 'Cubic.Out',
    });
  }

  setHealth(side, value, animate = true) {
    const isPlayer = side === 'player';
    const hpKey = isPlayer ? 'playerHp' : 'enemyHp';
    const maxKey = isPlayer ? 'playerMaxHp' : 'enemyMaxHp';
    const bar = isPlayer ? this.playerBar : this.enemyBar;
    const text = isPlayer ? this.playerHpText : this.enemyHpText;
    const barStart = isPlayer ? 38 : 650;
    this[hpKey] = Math.max(0, Math.min(this[maxKey], value));
    text.setText(`HP ${this[hpKey]} / ${this[maxKey]}`);
    const targetWidth = 200 * this[hpKey] / this[maxKey];
    this.hpBarTweens[side]?.stop();
    this.hpBarTweens[side] = null;
    const placeBar = () => { bar.x = barStart + bar.displayWidth / 2; };
    if (!animate || Math.abs(bar.displayWidth - targetWidth) < .1) {
      bar.displayWidth = targetWidth;
      placeBar();
      return;
    }
    this.hpBarTweens[side] = this.tweens.add({
      targets: bar,
      displayWidth: targetWidth,
      duration: 320,
      ease: 'Cubic.Out',
      onUpdate: placeBar,
      onComplete: () => { this.hpBarTweens[side] = null; placeBar(); },
    });
  }

  refreshHealthUi(force = false) {
    const refresh = (side) => {
      const isPlayer = side === 'player';
      const hp = this[isPlayer ? 'playerHp' : 'enemyHp'];
      const maxHp = this[isPlayer ? 'playerMaxHp' : 'enemyMaxHp'];
      const text = isPlayer ? this.playerHpText : this.enemyHpText;
      text.setText(`HP ${hp} / ${maxHp}`);
      if (force || !this.hpBarTweens?.[side]) this.setHealth(side, hp, false);
    };
    refresh('player');
    refresh('enemy');
  }

  animateFocus(emphatic = false) {
    const baseScale = this.playerFigure.scaleX;
    this.tweens.add({
      targets: this.playerFigure,
      scaleX: baseScale * (emphatic ? 1.12 : 1.07),
      scaleY: baseScale * (emphatic ? 1.12 : 1.07),
      alpha: .72,
      duration: 130,
      yoyo: true,
      ease: 'Sine.InOut',
    });
  }

  playPlayerSlashTrail(emphatic = false) {
    // 내장 attack 시트의 검기는 프레임 가장자리에서 좌우로 튀어 보일 수 있어,
    // 플레이어의 전방(오른쪽)에만 독립 검기를 두고 짧게 전진시킨다.
    const startX = this.playerFigure.x + (emphatic ? 82 : 70);
    const effect = pixelSprite(this, startX, this.playerFigure.y - 6, 'combat-effects', 'attack', emphatic ? 84 : 62)
      .setOrigin(.5).setDepth(14).setTint(0xf8f1ff).setAlpha(.9);
    const baseScale = effect.scaleX;
    this.tweens.add({
      targets: effect,
      x: startX + (emphatic ? 42 : 32),
      alpha: 0,
      scaleX: baseScale * 1.18,
      scaleY: baseScale * 1.18,
      duration: emphatic ? 260 : 210,
      ease: 'Quad.Out',
      onComplete: () => effect.destroy(),
    });
  }

  collapseEnemyCharge() {
    if (!this.enemyFigure?.active) return;
    const figure = this.enemyFigure;
    const baseScaleX = figure.scaleX;
    const baseScaleY = figure.scaleY;
    figure.setTint(0xffd56a);
    this.playEffect('rhythm', figure.x, figure.y - 42, 116, true, 520, 16);
    this.playEffect('attack', figure.x - 44, figure.y - 4, 92, true, 420, 16);
    this.tweens.add({
      targets: figure,
      scaleX: baseScaleX * .9,
      scaleY: baseScaleY * .9,
      angle: -10,
      duration: 120,
      yoyo: true,
      hold: 160,
      ease: 'Quad.Out',
      onComplete: () => { if (figure?.active) figure.setScale(baseScaleX, baseScaleY).setAngle(0).clearTint(); },
    });
  }

  pulseRhythm(emphatic = false) {
    this.tweens.add({
      targets: [...this.rhythmBoxes, this.rhythmText],
      scaleX: emphatic ? 1.2 : 1.1,
      scaleY: emphatic ? 1.2 : 1.1,
      duration: emphatic ? 135 : 105,
      yoyo: true,
      ease: 'Back.Out',
    });
  }

  animateIntent(intent) {
    const dangerous = intent.key === 'heavy' || intent.key === 'charge';
    this.tweens.add({
      targets: [this.intentText, this.intentDetail],
      scaleX: dangerous ? 1.1 : 1.05,
      scaleY: dangerous ? 1.1 : 1.05,
      duration: 130,
      yoyo: true,
      ease: 'Quad.Out',
    });
    if (dangerous && this.enemyFigure) {
      const baseScale = this.enemyFigure.scaleX;
      this.tweens.add({
        targets: this.enemyFigure,
        scaleX: baseScale * 1.045,
        scaleY: baseScale * 1.045,
        duration: 160,
        yoyo: true,
        ease: 'Sine.InOut',
      });
    }
    if (intent.key === 'heavy') this.cameras.main.shake(90, .0025);
  }

  lockActionInput(duration = 410) {
    this.inputLocked = true;
    this.updateActionInputs();
    if (this.actionUnlockTimer) this.actionUnlockTimer.remove(false);
    this.actionUnlockTimer = this.time.delayedCall(duration, () => {
      this.actionUnlockTimer = null;
      this.inputLocked = false;
      this.updateActionInputs();
    });
  }

  updateActionInputs() {
    const enabled = !this.over && !this.inputLocked;
    Object.values(this.buttons).forEach((button) => { button.container.input.enabled = enabled; });
    this.buttons.focus.container.input.enabled = enabled && !this.isDown();
    this.buttons.focus.container.setAlpha(enabled && !this.isDown() ? 1 : .35);
    const finisherReady = enabled && this.rhythm === 3;
    this.buttons.finisher.container.input.enabled = finisherReady;
    this.buttons.finisher.container.setAlpha(finisherReady ? 1 : .35);
  }

  tutorialOutcome(action) {
    const enemy = this.currentIntent();
    const startedDown = this.isDown();
    const defendingEnemy = enemy.key === 'defend';
    const attackingEnemy = enemy.key === 'attack' || enemy.key === 'heavy';
    const chargeInterrupted = enemy.key === 'charge' && action === 'attack';
    const outcome = { enemy, action, startedDown, playerDamage: 0, enemyDamage: 0, rhythmGain: 0, consumeRhythm: action === 'finisher', causesDown: false, chargeInterrupted, enemyRhythmGain: 0, consumeEnemyRhythm: enemy.key === 'heavy', line: '' };
    if (action === 'attack') {
      outcome.playerDamage = defendingEnemy ? 3 : 7;
      outcome.line = chargeInterrupted ? '검격이 힘 모으기를 끊었다. 적의 강공격 준비가 취소된다.' : defendingEnemy ? `${this.enemyConfig.displayName}이 방어 자세로 검격을 흘렸다. 피해가 줄었다.` : `검격이 ${this.enemyConfig.displayName}에게 적중했다.`;
    } else if (action === 'finisher') {
      outcome.playerDamage = defendingEnemy ? 8 : 16;
      outcome.line = defendingEnemy ? '강공격이 방어에 막혀 피해가 줄었다.' : '강공격! 강한 일격을 날렸다.';
    } else if (action === 'defend') {
      outcome.enemyDamage = attackingEnemy ? (enemy.key === 'heavy' ? 2 : Math.ceil(enemy.damage / 2)) : 0;
      outcome.line = attackingEnemy ? `방패를 먼저 들어 ${this.enemyConfig.displayName}의 공격을 막았다.` : '서로 방어 자세를 취했다.';
    } else if (action === 'focus') {
      outcome.rhythmGain = defendingEnemy ? 2 : 1;
      outcome.causesDown = attackingEnemy;
      if (attackingEnemy) {
        outcome.rhythmGain = 0;
        outcome.enemyDamage = enemy.damage;
        outcome.line = '집중 중 공격을 맞아 다운됐다. 다음 턴에는 집중할 수 없다.';
      } else {
        outcome.line = defendingEnemy ? `${this.enemyConfig.displayName}이 막는 동안 기를 모았다. 리듬 +2` : '기를 모았다. 리듬 +1';
      }
    }
    if (action !== 'defend' && attackingEnemy && action !== 'focus') outcome.enemyDamage = enemy.damage;
    if (enemy.key === 'charge' && !chargeInterrupted) {
      outcome.enemyRhythmGain = 1;
      outcome.line = `${this.enemyConfig.logName}이 힘을 모아 적 리듬을 쌓았다.`;
    }
    return outcome;
  }

  showEnemyGuard() {
    this.setEnemyPose('guard', true);
    this.animateGoblinGuard();
    this.showGuard('enemy');
  }

  applyTutorialEnemyHit(outcome) {
    if (!outcome.playerDamage || this.enemyHp <= 0) return;
    this.resolutionPhase = 'collision';
    this.setHealth('enemy', this.enemyHp - outcome.playerDamage);
    const guarded = outcome.enemy.key === 'defend';
    if (guarded) {
      this.animateGuardParry('enemy');
      this.showGuard('enemy', true);
    }
    else {
      this.setEnemyPose('hurt', true);
      this.flashCombatant('enemy', 0xeb5b67, outcome.action === 'finisher');
    }
    if (outcome.chargeInterrupted) {
      this.collapseEnemyCharge();
      this.showFloatingText(this.enemyFigure.x, this.enemyFigure.y - 92, '차단!', '#ffd56a', true);
    }
    // 왼쪽의 기사가 내리친 지점에 효과를 두어, 방어 중인 적의 몸통·가드 효과를 덮지 않는다.
    // 가드 중 고블린의 몸통·가드 파형보다 왼쪽, 즉 양측 사이에서만 충돌시킨다.
    const impactX = this.enemyFigure.x - (guarded ? 172 : 88);
    this.playEffect('attack', impactX, this.enemyFigure.y - 4, outcome.action === 'finisher' ? 112 : (guarded ? 60 : 78), outcome.action === 'finisher', undefined, 6);
    this.showFloatingText(this.enemyFigure.x, this.enemyFigure.y - 58, `-${outcome.playerDamage}`, '#ffb1b8', outcome.action === 'finisher');
  }

  applyTutorialPlayerHit(outcome) {
    if (!outcome.enemyDamage || this.playerHp <= 0 || this.enemyHp <= 0) return;
    this.resolutionPhase = 'collision';
    this.setHealth('player', this.playerHp - outcome.enemyDamage);
    const blocked = outcome.action === 'defend';
    if (blocked) {
      this.showGuard('player', true);
      this.animateGuardParry('player');
    }
    else {
      this.setPlayerPose('hurt', true);
      this.flashCombatant('player', 0xeb5b67, false);
    }
    this.showFloatingText(this.playerFigure.x, this.playerFigure.y - 58, `-${outcome.enemyDamage}`, blocked ? '#9fdcff' : '#ffb1b8', blocked);
    if (outcome.causesDown) this.setPlayerPose('down', true);
    audio.play(blocked ? 'defend' : 'hit');
  }

  finishTutorialTurn(outcome, fromPointer = false) {
    this.resolutionPhase = 'complete';
    if (this.enemyHp <= 0) { this.finish(true, `${outcome.line}\n${this.enemyConfig.logName}을 쓰러뜨렸다!`); return; }
    if (this.playerHp <= 0) { this.finish(false, `${outcome.line}\n수습 기사가 쓰러졌다…`); return; }
    if (outcome.consumeRhythm) this.rhythm = 0;
    if (outcome.consumeEnemyRhythm) this.enemyRhythm = 0;
    if (outcome.enemyRhythmGain) {
      this.enemyRhythm = Math.min(3, this.enemyRhythm + outcome.enemyRhythmGain);
      this.playEffect('rhythm', this.enemyFigure.x, this.enemyFigure.y - 46, 78, this.enemyRhythm === 3);
      audio.play('charge');
    }
    if (outcome.rhythmGain) {
      this.rhythm = Math.min(3, this.rhythm + outcome.rhythmGain);
      this.playEffect('rhythm', 185, 432, outcome.rhythmGain === 2 ? 98 : 76, outcome.rhythmGain === 2);
      this.showFloatingText(165, 440, `리듬 +${outcome.rhythmGain}`, '#ffd56a', outcome.rhythmGain === 2);
      this.pulseRhythm(outcome.rhythmGain === 2);
      audio.play('rhythm');
    }
    this.downTurns = outcome.causesDown ? 1 : outcome.startedDown ? 0 : 0;
    // 공격으로 충전을 끊으면 다음 공격 칸(예약 강공격 후보)도 지나간다.
    const nextBaseIntent = this.intentQueue[(this.turn + 1) % this.intentQueue.length];
    this.turn += outcome.chargeInterrupted && nextBaseIntent.key === 'attack' ? 2 : 1;
    this.log = outcome.line;
    if (this.isDown()) this.setPlayerPose('down', true);
    else if (outcome.startedDown) {
      this.setPlayerPose('hurt', true);
      this.scheduleResolution(380, () => { if (!this.over) this.setPlayerPose('idle', true); });
    } else this.setPlayerPose('idle', true);
    this.setEnemyPose('idle', true);
    this.resetGoblinPose();
    // 다운 뒤 행동은 일어서는 프레임을 읽은 뒤에만 다시 누를 수 있게 한다.
    if (fromPointer && outcome.startedDown && !outcome.causesDown) {
      this.inputLocked = true;
      this.scheduleResolution(380, () => {
        if (!this.over) {
          this.inputLocked = false;
          this.updateActionInputs();
        }
      });
    } else this.inputLocked = false;
    this.render();
  }

  resolveTutorialTurn(action, fromPointer) {
    const outcome = this.tutorialOutcome(action);
    const playerStrike = action === 'attack' || action === 'finisher';
    const strikeDuration = action === 'finisher' ? 560 : 360;
    const beginPlayerStrike = () => {
      this.setPlayerPose(action === 'finisher' ? 'heavy' : 'attack', true);
      this.animateLunge('player', action === 'finisher');
      if (action === 'attack') this.playPlayerSlashTrail();
      if (action === 'finisher') this.cameras.main.shake(110, .004);
      audio.play(action === 'finisher' ? 'finisher' : 'attack');
    };
    const beginEnemyStrike = () => {
      if (this.enemyHp <= 0) return;
      this.setEnemyPose('attack', true);
      this.animateLunge('enemy');
      audio.play('enemyAttack');
    };
    const beginEnemyCharge = () => {
      if (this.enemyHp <= 0) return;
      this.setEnemyPose('charge', true);
      const baseScale = this.enemyFigure.scaleX;
      this.tweens.add({ targets: this.enemyFigure, scaleX: baseScale * 1.1, scaleY: baseScale * 1.1, duration: 150, yoyo: true, ease: 'Sine.InOut' });
      audio.play('charge');
    };
    const beginPlayerGuard = () => { this.setPlayerPose('guard', true); this.showGuard('player'); };
    const beginFocus = () => { this.setPlayerPose('focus', true); audio.play('focus'); };
    const finish = () => this.finishTutorialTurn(outcome, fromPointer);

    if (!fromPointer) {
      if (outcome.enemy.key === 'defend') this.showEnemyGuard();
      if (action === 'defend') beginPlayerGuard();
      else if (action === 'focus') beginFocus();
      else beginPlayerStrike();
      this.applyTutorialEnemyHit(outcome);
      if (outcome.enemy.key === 'charge') beginEnemyCharge();
      else if (outcome.enemy.key === 'attack' || outcome.enemy.key === 'heavy') beginEnemyStrike();
      this.applyTutorialPlayerHit(outcome);
      finish();
      return;
    }

    this.inputLocked = true;
    this.resolutionPhase = 'preparing';
    this.updateActionInputs();
    this.clearResolutionTimers();
    if (outcome.enemy.key === 'defend') {
      this.showEnemyGuard();
      if (playerStrike) {
        this.scheduleResolution(360, beginPlayerStrike);
        this.scheduleResolution(360 + strikeDuration, () => this.applyTutorialEnemyHit(outcome));
        this.scheduleResolution(action === 'finisher' ? 1380 : 1280, finish);
      } else if (action === 'defend') {
        beginPlayerGuard();
        this.scheduleResolution(980, finish);
      } else {
        beginFocus();
        this.scheduleResolution(420, this.showEnemyGuard.bind(this));
        this.scheduleResolution(1150, finish);
      }
      return;
    }

    if (outcome.enemy.key === 'charge') {
      if (playerStrike) {
        beginPlayerStrike();
        this.scheduleResolution(strikeDuration, () => this.applyTutorialEnemyHit(outcome));
        this.scheduleResolution(760 + strikeDuration, finish);
      } else {
        if (action === 'defend') beginPlayerGuard(); else beginFocus();
        this.scheduleResolution(360, beginEnemyCharge);
        this.scheduleResolution(1050, finish);
      }
      return;
    }

    if (action === 'defend') {
      beginPlayerGuard();
      this.scheduleResolution(440, beginEnemyStrike);
      this.scheduleResolution(780, () => this.applyTutorialPlayerHit(outcome));
      this.scheduleResolution(1280, finish);
    } else if (action === 'focus') {
      beginFocus();
      this.scheduleResolution(460, beginEnemyStrike);
      this.scheduleResolution(800, () => this.applyTutorialPlayerHit(outcome));
      this.scheduleResolution(1350, finish);
    } else {
      beginPlayerStrike();
      this.scheduleResolution(strikeDuration, () => this.applyTutorialEnemyHit(outcome));
      this.scheduleResolution(420 + strikeDuration, beginEnemyStrike);
      this.scheduleResolution(760 + strikeDuration, () => this.applyTutorialPlayerHit(outcome));
      this.scheduleResolution(1220 + strikeDuration, finish);
    }
  }

  takeTurn(action, fromPointer = false) {
    if (this.over || !['attack', 'defend', 'focus', 'finisher'].includes(action) || (action === 'finisher' && this.rhythm < 3)) return;
    if (action === 'focus' && this.isDown()) return;
    if (this.isPatternEnemy()) {
      this.resolveTutorialTurn(action, fromPointer);
      return;
    }
    if (fromPointer) this.lockActionInput(action === 'finisher' ? 500 : 410);
    // 이번 예고와 기존 노출을 고정한다. 단계/다음 노출은 양측 생존 확인 뒤 갱신한다.
    const enemy = this.currentIntent();
    const wasExposed = this.sealBroken;
    const chargeInterrupted = enemy.key === 'charge' && action === 'attack';
    const opensSeal = !!this.enemyConfig.boss && (chargeInterrupted || (enemy.key === 'heavy' && action === 'defend'));
    let lines = [];
    let playerDamage = 0; let rhythmGain = 0; let enemyDamage = 0;
    if (action === 'attack') {
      this.animateLunge('player');
      audio.play('attack');
      playerDamage = enemy.key === 'defend' ? 3 : 7;
      if (enemy.key === 'charge') { rhythmGain = 2; lines.push('공격이 힘 모으기를 끊었다! 리듬 +2'); }
      else lines.push(enemy.key === 'defend' ? '방어에 막혀 피해가 줄었다.' : '검격이 적중했다.');
    } else if (action === 'defend') {
      this.animateFocus(enemy.key === 'heavy');
      audio.play('defend');
      if (enemy.key === 'heavy') { enemyDamage = 2; rhythmGain = 2; lines.push('강공격을 완벽히 막았다! 리듬 +2'); }
      else { enemyDamage = enemy.damage ? Math.ceil(enemy.damage / 2) : 0; lines.push('방어 태세를 갖췄다.'); }
    } else if (action === 'focus') {
      this.animateFocus(enemy.key === 'defend');
      audio.play('focus');
      rhythmGain = enemy.key === 'defend' ? 2 : 1; lines.push(enemy.key === 'defend' ? '적이 막는 틈에 집중했다! 리듬 +2' : '호흡을 고른다. 리듬 +1');
    } else if (action === 'finisher') {
      this.animateLunge('player', true);
      this.cameras.main.shake(150, .007);
      audio.play('finisher');
      playerDamage = this.enemyConfig.boss && wasExposed ? this.enemyConfig.boss.exposedFinisherDamage : 16;
      this.rhythm = 0; lines.push(playerDamage === 24 ? '봉인 파쇄! 노출 결정타 24 피해!' : '결정타! 방어를 꿰뚫는 일격을 날렸다.');
    }
    if (playerDamage) this.setHealth('enemy', this.enemyHp - playerDamage);
    this.rhythm = Math.min(3, this.rhythm + rhythmGain);
    if (playerDamage) {
      this.flashCombatant('enemy', chargeInterrupted ? 0xffd56a : 0xeb5b67, chargeInterrupted);
      this.playEffect('attack', this.enemyFigure.x, this.enemyFigure.y, chargeInterrupted ? 132 : 106, chargeInterrupted);
      this.showFloatingText(this.enemyFigure.x, this.enemyFigure.y - 58, `-${playerDamage}`, '#ffb1b8', chargeInterrupted);
    }
    if (rhythmGain) {
      this.playEffect('rhythm', 185, 432, rhythmGain === 2 ? 98 : 76, rhythmGain === 2);
      this.showFloatingText(165, 440, `리듬 +${rhythmGain}`, '#ffd56a', rhythmGain === 2);
      this.pulseRhythm(rhythmGain === 2);
      audio.play('rhythm');
    }
    if (action === 'defend') this.playEffect('guard', this.playerFigure.x, this.playerFigure.y, enemy.key === 'heavy' ? 132 : 106, enemy.key === 'heavy');
    if (action === 'focus') this.flashCombatant('player', 0x79bf78, rhythmGain === 2);
    if (this.enemyHp <= 0) { this.finish(true, `${lines.join(' ')}\n${this.enemyConfig.logName}을 쓰러뜨렸다!`); return; }
    // 방어가 아닌 행동은 예고된 공격을 그대로 받는다.
    if (action !== 'defend' && enemy.damage) enemyDamage = enemy.damage;
    if (chargeInterrupted) {
      lines.push('강공격 준비가 취소되었다.');
      this.showFloatingText(450, 178, '차단!', '#ffd56a', true);
      this.cameras.main.shake(130, .005);
      audio.play('interrupt');
    }
    else if (enemy.key === 'charge') {
      lines.push(`${this.enemyConfig.logName}은 다음 턴 강공격을 노린다.`);
      audio.play('charge');
    }
    else if (enemy.damage) {
      this.animateLunge('enemy', enemy.key === 'heavy');
      audio.play(enemy.key === 'heavy' ? 'heavy' : 'enemyAttack');
      this.setHealth('player', this.playerHp - enemyDamage); lines.push(`${this.enemyConfig.logName}의 ${enemy.name}: ${enemyDamage} 피해`);
      const blockedHeavy = enemy.key === 'heavy' && action === 'defend';
      this.flashCombatant('player', blockedHeavy ? 0x83d6ff : 0xeb5b67, blockedHeavy);
      this.showFloatingText(this.playerFigure.x, this.playerFigure.y - 58, `-${enemyDamage}`, blockedHeavy ? '#9fdcff' : '#ffb1b8', blockedHeavy);
      audio.play(blockedHeavy ? 'defend' : 'hit');
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
        this.cameras.main.flash(110, 255, 213, 106, false);
        audio.play('seal');
      }
      if (this.phase === 1 && this.enemyHp <= this.enemyConfig.boss.phaseThreshold) {
        this.phase = 2;
        this.phaseText.setText('심장석 균열\n다음 일반 공격부터 7 피해');
        this.enemyFigure.setTint(0xffd5a0);
        this.playEffect('rhythm', 748, 200, 150, true);
        audio.play('phase');
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
        audio.play('victory');
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
      const nextEnemy = ENEMY_PRESETS[this.battleOrder[nextIndex]];
      const carriedPlayerHp = nextEnemy?.boss
        ? this.playerMaxHp
        : Math.min(this.playerMaxHp, this.playerHp + Math.ceil(this.playerMaxHp * .2));
      this.registry.set('carriedPlayerHp', carriedPlayerHp);
      this.registry.set('defeatedEnemyId', this.enemyConfig.id);
      this.registry.set('battleIndex', nextIndex);
      this.scene.start('battleTransition');
      return;
    }
    this.registry.set('battleIndex', 0);
    this.scene.start('ending');
  }

  render(forceHealthSync = false) {
    const enemy = this.currentIntent();
    const intentColors = { attack: '#ff929b', heavy: '#ffad64', defend: '#8ec5ff', charge: '#d898ff' };
    const intentColor = intentColors[enemy.key] || '#ffd56a';
    const tutorial = this.isTutorial();
    const patternEnemy = this.isPatternEnemy();
    const headline = this.over ? (this.enemyHp <= 0 ? '승리!' : '패배…') : tutorial ? '훈련: 움직임을 보고 대응하세요' : patternEnemy ? '전투: 적의 자세를 관찰하세요' : `다음 행동 예고: ${enemy.name}`;
    const detail = this.over ? (this.enemyHp <= 0 ? '심장석의 봉인이 풀립니다.' : '다시 시작해 전투를 반복할 수 있습니다.') : tutorial ? '고블린은 공격과 방어 자세를 반복합니다.' : patternEnemy ? `${this.enemyConfig.displayName}의 자세와 결과를 관찰하세요.` : enemy.detail;
    this.intentText.setText(headline).setColor(patternEnemy && !this.over ? '#ffd56a' : intentColor);
    this.intentDetail.setText(detail);
    this.intentPanel.setStrokeStyle(patternEnemy ? 3 : enemy.key === 'heavy' ? 5 : 3, patternEnemy ? this.colors.gold : Phaser.Display.Color.HexStringToColor(intentColor).color);
    if (!patternEnemy && !this.over && this.lastIntentKey !== enemy.key) {
      this.lastIntentKey = enemy.key;
      this.animateIntent(enemy);
    }
    this.refreshHealthUi(forceHealthSync);
    this.rhythmBoxes.forEach((box, i) => box.setFillStyle(i < this.rhythm ? this.colors.gold : 0x362746)); this.rhythmText.setText(`${this.rhythm} / 3`);
    this.updateActionInputs();
    const finisher = this.buttons.finisher; finisher.bg.setFillStyle(finisher.color);
    this.sealText.setVisible(!!this.enemyConfig.boss && !this.over).setText(this.sealBroken ? '봉인 노출 · 이번 행동까지\n결정타 24 피해' : '봉인 닫힘 · 결정타 16 피해');
    if (this.sealRune) this.sealRune.setVisible(this.sealBroken && !this.over);
    this.downText.setText(this.isDown() && !this.over ? '다운 · 이번 턴 집중 불가' : '').setVisible(this.isDown() && !this.over);
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
    this.add.text(WIDTH / 2, 106, '성소의 봉인을 복구했다', { fontFamily: UI_FONT, fontSize: '20px', fontStyle: 'bold', color: '#ffd56a' }).setOrigin(.5);
    this.add.rectangle(WIDTH / 2, 345, 680, 150, 0x2a1d3b).setStrokeStyle(3, 0x9d7bbf);
    this.add.text(WIDTH / 2, 302, '심장석의 박동이 고르게 돌아온다.', { fontFamily: UI_FONT, fontSize: '18px', fontStyle: 'bold', color: '#f8f1ff' }).setOrigin(.5);
    this.add.text(WIDTH / 2, 347, '수습 기사는 심장석을 제자리에 고정하고\n성소의 봉인을 복구했다.', { fontFamily: UI_FONT, fontSize: '15px', color: '#c6b6d8', align: 'center', lineSpacing: 9 }).setOrigin(.5);
    this.makeButton('처음부터 다시', 450, 500, 220, 50, 0x765199, () => this.scene.start('intro'));
  }

  makeButton(label, x, y, w, h, color, callback) {
    const bg = this.add.rectangle(0, 0, w, h, color).setStrokeStyle(3, 0xf8f1ff);
    const text = this.add.text(0, 0, label, { fontFamily: UI_FONT, fontSize: '15px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(.5);
    const button = this.add.container(x, y, [bg, text]).setSize(w, h).setInteractive({ useHandCursor: true });
    button.on('pointerover', () => bg.setFillStyle(0xffd56a));
    button.on('pointerout', () => bg.setFillStyle(color));
    button.on('pointerdown', () => { audio.activate(); audio.play('button'); callback(); });
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
    this.add.text(WIDTH / 2, 130, '적 조우 완료', { fontFamily: UI_FONT, fontSize: '30px', fontStyle: 'bold', color: '#ffd56a' }).setOrigin(.5);
    const defeatedName = (currentEnemy && currentEnemy.displayName) || '적';
    const nextEnemyName = (nextEnemy && nextEnemy.displayName) || '다음 적';
    this.add.text(WIDTH / 2, 195, `${defeatedName}을 쓰러뜨렸다.`, { fontFamily: UI_FONT, fontSize: '18px', fontStyle: 'bold', color: '#f8f1ff' }).setOrigin(.5);
    this.add.text(WIDTH / 2, 225, `${nextEnemyName}가 봉인문으로 나아온다.`, { fontFamily: UI_FONT, fontSize: '17px', color: '#c6b6d8', align: 'center' }).setOrigin(.5);
    const carriedPlayerHp = this.registry.get('carriedPlayerHp');
    const preparation = typeof carriedPlayerHp === 'number'
      ? (nextEnemy.boss
        ? '전투 준비: HP 완전 회복 · 리듬 0으로 시작'
        : `전투 준비: HP ${carriedPlayerHp} · 최대 HP 20% 회복 · 리듬 0으로 시작`)
      : '전투 준비: HP 34 · 리듬 0으로 시작';
    this.add.text(WIDTH / 2, 269, preparation, { fontFamily: UI_FONT, fontSize: '14px', fontStyle: 'bold', color: '#ffd56a' }).setOrigin(.5);
    if (nextEnemy.boss) {
      this.add.text(WIDTH / 2, 311, '힘 모으기는 공격으로 끊고, 강공격은 방어로 버티세요.\n열린 봉인에 다음 행동으로 결정타를 넣으면 24 피해를 줍니다.', { fontFamily: UI_FONT, fontSize: '14px', color: '#f8f1ff', align: 'center', lineSpacing: 9 }).setOrigin(.5);
    }
    this.makeButton(nextEnemy.boss ? '심판관과 전투' : '다음 적과 전투', WIDTH / 2, 390, 240, 52, 0x6c9b56, () => this.scene.start('battle'));
    this.makeButton('처음부터 다시', WIDTH / 2, 480, 230, 48, 0x765199, () => {
      this.registry.set('battleIndex', 0);
      this.scene.start('intro');
    });
  }

  makeButton(label, x, y, w, h, color, callback) {
    const bg = this.add.rectangle(0, 0, w, h, color).setStrokeStyle(3, 0xf8f1ff);
    const text = this.add.text(0, 0, label, { fontFamily: UI_FONT, fontSize: '15px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(.5);
    const button = this.add.container(x, y, [bg, text]).setSize(w, h).setInteractive({ useHandCursor: true });
    button.on('pointerover', () => bg.setFillStyle(0xffd56a));
    button.on('pointerout', () => bg.setFillStyle(color));
    button.on('pointerdown', () => { audio.activate(); audio.play('button'); callback(); });
  }
}

const game = new Phaser.Game({ type: Phaser.AUTO, width: WIDTH, height: HEIGHT, parent: 'game', backgroundColor: '#171024', scene: [BootScene, IntroScene, BattleScene, BattleTransitionScene, EndingScene], render: { antialias: false, pixelArt: true }, scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH } });
window.__battleGame = game;
