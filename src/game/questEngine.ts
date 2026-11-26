import type { AreaId, CharacterIdentity, DialogueChoice, QuestFlags, QuestObjective } from '../types/world';

export function createInitialQuestFlags(): QuestFlags {
  return {
    metLiZhong: false,
    drankAtPanTavern: false,
    heardJinCuilian: false,
    defeatedZhengTu: false,
    reachedWutai: false,
    tookTonsure: false,
    drankMountainWine: false,
    shookMountainGate: false,
    receivedAbbotLetter: false,
    enteredBianliang: false,
    uprootedWillow: false,
  };
}

export function getCharacterIdentity(flags: QuestFlags): CharacterIdentity {
  return flags.tookTonsure ? 'luzhishen' : 'luda';
}

export function getActiveObjective(flags: QuestFlags): QuestObjective {
  const milestones = [
    flags.heardJinCuilian,
    flags.defeatedZhengTu,
    flags.tookTonsure,
    flags.receivedAbbotLetter,
    flags.uprootedWillow,
  ];
  const completedCount = milestones.filter(Boolean).length;
  const totalSteps = milestones.length;

  if (!flags.heardJinCuilian) {
    return {
      chapter: 1,
      chapterTitle: '第一回 · 渭州酒楼义听冤',
      summary: '北上入渭州状元桥坊，步入「潘家酒楼内」与史进饮酒，探问金翠莲啼哭缘由。',
      targetArea: 'tavern_interior',
      targetLabel: '潘家酒楼内',
      completedCount,
      totalSteps,
      allCompleted: false,
    };
  }

  if (!flags.defeatedZhengTu) {
    return {
      chapter: 2,
      chapterTitle: '第二回 · 三拳怒打镇关西',
      summary: '返回渭州状元桥东侧肉铺，寻恶霸「郑屠」讨回公道（对话或按 J 施展武艺）。',
      targetArea: 'weizhou_town',
      targetLabel: '渭州状元桥坊',
      completedCount,
      totalSteps,
      allCompleted: false,
    };
  }

  if (!flags.tookTonsure) {
    return {
      chapter: 3,
      chapterTitle: '第三回 · 五台巍峨剃度僧',
      summary: '出渭州东行登「五台山群峰」，经山门步入「文殊院 · 大雄宝殿内」拜见智真长老剃度。',
      targetArea: 'temple_interior',
      targetLabel: '大雄宝殿内',
      completedCount,
      totalSteps,
      allCompleted: false,
    };
  }

  if (!flags.receivedAbbotLetter) {
    return {
      chapter: 4,
      chapterTitle: '第四回 · 半山夺酒领偈言',
      summary: '可往五台山「半山亭」痛饮山酒、震慑山门金刚，再返大雄宝殿向智真长老请领东京荐书。',
      targetArea: 'temple_interior',
      targetLabel: '大雄宝殿内',
      completedCount,
      totalSteps,
      allCompleted: false,
    };
  }

  if (!flags.uprootedWillow) {
    return {
      chapter: 5,
      chapterTitle: '第五回 · 东京汴梁拔垂杨',
      summary: '赴「东京汴梁城」穿宣德城门、逛御街闹市，至大相国寺菜园施展神力倒拔垂杨柳！',
      targetArea: 'bianliang_city',
      targetLabel: '东京汴梁城',
      completedCount,
      totalSteps,
      allCompleted: false,
    };
  }

  return {
    chapter: 5,
    chapterTitle: '花和尚威震东京 · 游历圆满',
    summary: '鲁智深前期五回主线已全数经历！可继续自由漫游二区域、三场景与二建筑内部。',
    targetArea: 'bianliang_city',
    targetLabel: '自由游历',
    completedCount,
    totalSteps,
    allCompleted: true,
  };
}

export interface EffectResult {
  nextFlags: QuestFlags;
  toast: string | null;
  triggerAction?: 'punch' | 'wine' | 'tonsure' | 'willow' | 'gong';
}

export function applyDialogueEffect(
  flags: QuestFlags,
  effect: DialogueChoice['effect']
): EffectResult {
  const nextFlags: QuestFlags = { ...flags };
  switch (effect) {
    case 'drink_tavern_wine':
      nextFlags.drankAtPanTavern = true;
      return {
        nextFlags,
        toast: '豪饮潘家状元红！豪气大振，精力充沛。',
        triggerAction: 'wine',
      };
    case 'hear_jin_story':
      nextFlags.heardJinCuilian = true;
      return {
        nextFlags,
        toast: '已听闻金翠莲冤情：前往状元桥东侧肉铺惩治镇关西郑屠！',
      };
    case 'fight_zhengtu':
      nextFlags.heardJinCuilian = true;
      nextFlags.defeatedZhengTu = true;
      return {
        nextFlags,
        toast: '三拳打倒镇关西！速出渭州东行前往五台山避祸！',
        triggerAction: 'punch',
      };
    case 'take_tonsure':
      nextFlags.reachedWutai = true;
      nextFlags.tookTonsure = true;
      return {
        nextFlags,
        toast: '落发披缁，赐法名「智深」！鲁达化身花和尚鲁智深，手持浑铁禅杖！',
        triggerAction: 'tonsure',
      };
    case 'buy_mountain_wine':
      nextFlags.reachedWutai = true;
      nextFlags.drankMountainWine = true;
      return {
        nextFlags,
        toast: '半山亭痛饮一桶山酒！豪兴大发，回文殊院山门走一遭吧！',
        triggerAction: 'wine',
      };
    case 'receive_letter':
      nextFlags.tookTonsure = true;
      nextFlags.receivedAbbotLetter = true;
      return {
        nextFlags,
        toast: '领受智真长老四句偈言与荐书！启程奔赴东京汴梁城大相国寺！',
        triggerAction: 'gong',
      };
    case 'uproot_willow_action':
      nextFlags.enteredBianliang = true;
      nextFlags.uprootedWillow = true;
      return {
        nextFlags,
        toast: '花和尚神力惊天，倒拔垂杨柳！众泼皮纳头便拜！',
        triggerAction: 'willow',
      };
    default:
      return { nextFlags, toast: null };
  }
}

export function onAreaEntered(flags: QuestFlags, areaId: AreaId): QuestFlags {
  const next = { ...flags };
  if (areaId === 'wutai_region' || areaId === 'wutai_temple') {
    next.reachedWutai = true;
  }
  if (areaId === 'bianliang_city') {
    next.enteredBianliang = true;
  }
  return next;
}
