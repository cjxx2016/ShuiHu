import type { AreaConfig, AreaId, DialogueNode, QuestFlags } from '../types/world';

export const AREA_ORDER: AreaId[] = [
  'weizhou_region',
  'wutai_region',
  'weizhou_town',
  'wutai_temple',
  'bianliang_city',
  'tavern_interior',
  'temple_interior',
];

export const AREAS: Record<AreaId, AreaConfig> = {
  // ==========================================================================
  // 2 大区域 (Monumental Chunk-Streamed Open Regions)
  // ==========================================================================
  weizhou_region: {
    id: 'weizhou_region',
    tier: 'region',
    tierLabel: '大区域',
    name: '渭州郊野 · 官道',
    subtitle: '小种经略相公治下 · 渭水河谷、十里长亭与关西群峰',
    poem: '渭水苍茫绕画桥，官道柳色接青霄。',
    size: 92,
    defaultSpawn: { x: 4, z: 46, yaw: Math.PI },
    defaultTime: 'noon',
    ambientHint: '沿官道过红桥北上入渭州状元桥坊，东行山道直通五台山群峰。',
    waterLevel: 6.0,
    isIndoor: false,
    portals: [
      {
        id: 'to_weizhou_town',
        label: '进入 渭州·状元桥坊',
        targetArea: 'weizhou_town',
        x: 0,
        z: -74,
        radius: 6.0,
        spawnX: 0,
        spawnZ: 40,
        spawnYaw: Math.PI,
        kind: 'gate',
      },
      {
        id: 'to_wutai_region',
        label: '前往 五台山群峰',
        targetArea: 'wutai_region',
        x: 74,
        z: -22,
        radius: 6.0,
        spawnX: 4,
        spawnZ: 68,
        spawnYaw: Math.PI,
        kind: 'mountain_pass',
      },
    ],
    npcs: [
      {
        id: 'lizhong_road',
        name: '李忠',
        title: '打虎将 · 卖药把式',
        role: 'lizhong',
        x: -14,
        z: -3,
        yaw: 0.7,
        interactable: true,
      },
      {
        id: 'weizhou_traveler',
        name: '关西行商',
        title: '过路客商',
        role: 'merchant',
        x: 5,
        z: 10,
        yaw: 0,
        interactable: true,
        patrol: [
          { x: 5, z: 32 },
          { x: 0, z: -38 },
        ],
        speed: 2.3,
      },
      {
        id: 'weizhou_guard',
        name: '经略府军汉',
        title: '巡道步卒',
        role: 'guard',
        x: 6,
        z: -62,
        yaw: 0.2,
        interactable: true,
        patrol: [
          { x: 8, z: -64 },
          { x: -8, z: -64 },
        ],
        speed: 1.8,
      },
    ],
    props: [],
  },

  wutai_region: {
    id: 'wutai_region',
    tier: 'region',
    tierLabel: '大区域',
    name: '五台山 · 巍峨群峰',
    subtitle: '清凉圣境 · 五峰插汉、飞瀑深涧与半山亭',
    poem: '五峰插汉白云深，万壑松风伴梵音。',
    size: 92,
    defaultSpawn: { x: 2, z: 56, yaw: Math.PI },
    defaultTime: 'dawn',
    ambientHint: '沿石阶盘山而上过飞瀑溪桥，可达半山亭与文殊院；东南驿道直通东京汴梁。',
    waterLevel: 7.0,
    isIndoor: false,
    portals: [
      {
        id: 'to_wutai_temple',
        label: '踏入 五台山·文殊院',
        targetArea: 'wutai_temple',
        x: 0,
        z: -72,
        radius: 6.0,
        spawnX: 0,
        spawnZ: 42,
        spawnYaw: Math.PI,
        kind: 'gate',
      },
      {
        id: 'back_weizhou_region',
        label: '下山返回 渭州郊野',
        targetArea: 'weizhou_region',
        x: 4,
        z: 78,
        radius: 6.0,
        spawnX: 64,
        spawnZ: -22,
        spawnYaw: -Math.PI / 2,
        kind: 'mountain_pass',
      },
      {
        id: 'to_bianliang_city',
        label: '启程赴 东京汴梁城',
        targetArea: 'bianliang_city',
        x: 72,
        z: 44,
        radius: 6.0,
        spawnX: 0,
        spawnZ: 64,
        spawnYaw: Math.PI,
        kind: 'road',
      },
    ],
    npcs: [
      {
        id: 'wine_peddler',
        name: '挑酒汉',
        title: '山下酒贩',
        role: 'wine_peddler',
        x: 18,
        z: 6,
        yaw: -0.9,
        interactable: true,
      },
      {
        id: 'wutai_pilgrim',
        name: '进香居士',
        title: '登山香客',
        role: 'citizen',
        x: -2,
        z: 24,
        yaw: Math.PI,
        interactable: true,
        patrol: [
          { x: 2, z: 30 },
          { x: 4, z: -26 },
        ],
        speed: 1.9,
      },
    ],
    props: [
      {
        id: 'halfway_wine_buckets',
        label: '半山亭酒桶 · 痛饮山酒',
        x: 21.5,
        z: 3.5,
        radius: 4.5,
        actionType: 'drink_wine',
      },
    ],
  },

  // ==========================================================================
  // 3 个场景 (Monumental Architectural Settlements)
  // ==========================================================================
  weizhou_town: {
    id: 'weizhou_town',
    tier: 'scene',
    tierLabel: '城镇场景',
    name: '渭州府 · 状元桥坊',
    subtitle: '状元虹桥、三层潘家酒楼与镇关西肉铺',
    poem: '状元桥下水潺潺，三拳怒打镇关西。',
    size: 52,
    defaultSpawn: { x: 0, z: 38, yaw: Math.PI },
    defaultTime: 'sunset',
    ambientHint: '过状元虹桥西侧乃潘家酒楼，东侧即郑屠肉铺。',
    waterLevel: 4.0,
    isIndoor: false,
    portals: [
      {
        id: 'town_to_weizhou_region',
        label: '出南城门至 渭州郊野',
        targetArea: 'weizhou_region',
        x: 0,
        z: 46,
        radius: 5.0,
        spawnX: 0,
        spawnZ: -64,
        spawnYaw: 0,
        kind: 'gate',
      },
      {
        id: 'enter_pan_tavern',
        label: '步入 潘家酒楼内',
        targetArea: 'tavern_interior',
        x: -12,
        z: -22,
        radius: 4.5,
        spawnX: 0,
        spawnZ: 5.5,
        spawnYaw: Math.PI,
        kind: 'door',
      },
    ],
    npcs: [
      {
        id: 'zhengtu',
        name: '郑屠',
        title: '镇关西 · 肉铺恶霸',
        role: 'zhengtu',
        x: 14,
        z: -20,
        yaw: -Math.PI / 2,
        interactable: true,
      },
      {
        id: 'town_shijin',
        name: '史进',
        title: '九纹龙',
        role: 'shijin',
        x: -8,
        z: -14,
        yaw: 0.4,
        interactable: true,
      },
      {
        id: 'weizhou_citizen_1',
        name: '渭州街坊',
        title: '市井百姓',
        role: 'citizen',
        x: -12,
        z: 16,
        yaw: 1.5,
        interactable: true,
        patrol: [
          { x: -16, z: 16 },
          { x: 16, z: 16 },
        ],
        speed: 1.9,
      },
      {
        id: 'weizhou_merchant_1',
        name: '布庄掌柜',
        title: '街市商贩',
        role: 'merchant',
        x: 10,
        z: -32,
        yaw: 0,
        interactable: true,
        patrol: [
          { x: -12, z: -32 },
          { x: 14, z: -32 },
        ],
        speed: 1.7,
      },
    ],
    props: [
      {
        id: 'zheng_chopping_block',
        label: '郑屠肉案 · 拳打镇关西',
        x: 14,
        z: -20,
        radius: 4.8,
        actionType: 'confront_zheng',
      },
    ],
  },

  wutai_temple: {
    id: 'wutai_temple',
    tier: 'scene',
    tierLabel: '寺观场景',
    name: '五台山 · 文殊院',
    subtitle: '山门金刚、清凉宝塔、钟楼与大雄宝殿',
    poem: '暮鼓晨钟醒世人，醉打山门震金刚。',
    size: 52,
    defaultSpawn: { x: 0, z: 45, yaw: Math.PI },
    defaultTime: 'dawn',
    ambientHint: '穿山门登三叠石阶可达大雄宝殿；东侧耸立清凉宝塔，西侧为晨钟阁。',
    waterLevel: null,
    isIndoor: false,
    portals: [
      {
        id: 'temple_to_wutai_region',
        label: '下山门至 五台山群峰',
        targetArea: 'wutai_region',
        x: 0,
        z: 49.5,
        radius: 4.0,
        spawnX: 0,
        spawnZ: -64,
        spawnYaw: 0,
        kind: 'gate',
      },
      {
        id: 'enter_temple_hall',
        label: '步入 大雄宝殿内',
        targetArea: 'temple_interior',
        x: 0,
        z: -19,
        radius: 4.5,
        spawnX: 0,
        spawnZ: 6.0,
        spawnYaw: Math.PI,
        kind: 'door',
      },
    ],
    npcs: [
      {
        id: 'monk_jiansi',
        name: '监寺首座',
        title: '文殊院执事僧',
        role: 'monk',
        x: 7,
        z: 28,
        yaw: -0.6,
        interactable: true,
      },
      {
        id: 'monk_sweeper',
        name: '知客僧',
        title: '山院行者',
        role: 'monk',
        x: -10,
        z: 6,
        yaw: 0.9,
        interactable: true,
        patrol: [
          { x: -12, z: 10 },
          { x: -12, z: -2 },
        ],
        speed: 1.5,
      },
      {
        id: 'monk_upper',
        name: '侍香僧',
        title: '殿前僧人',
        role: 'monk',
        x: 10,
        z: -16,
        yaw: -0.4,
        interactable: true,
      },
    ],
    props: [
      {
        id: 'mountain_gate_guardian',
        label: '山门金刚塑像 · 醉打山门',
        x: -6,
        z: 32,
        radius: 4.8,
        actionType: 'strike_guardian',
      },
    ],
  },

  bianliang_city: {
    id: 'bianliang_city',
    tier: 'scene',
    tierLabel: '都城场景',
    name: '东京汴梁城',
    subtitle: '宣德巍峨重檐城门、州桥御街烟火与大相国寺菜园',
    poem: '八荒争凑万国通，十里御街灯火红。',
    size: 74,
    defaultSpawn: { x: 0, z: 65, yaw: Math.PI },
    defaultTime: 'sunset',
    ambientHint: '过护城河州桥入雄伟宣德城门即十里御街；北至大相国寺菜园可寻百年垂杨柳。',
    waterLevel: 4.0,
    isIndoor: false,
    portals: [
      {
        id: 'bianliang_to_wutai',
        label: '出城南道赴 五台山',
        targetArea: 'wutai_region',
        x: 0,
        z: 70.5,
        radius: 4.4,
        spawnX: 64,
        spawnZ: 44,
        spawnYaw: -Math.PI / 2,
        kind: 'road',
      },
      {
        id: 'bianliang_to_tavern',
        label: '入 樊楼酒肆内',
        targetArea: 'tavern_interior',
        x: -15,
        z: -4,
        radius: 4.5,
        spawnX: 0,
        spawnZ: 5.5,
        spawnYaw: Math.PI,
        kind: 'door',
      },
      {
        id: 'bianliang_to_temple',
        label: '入 大相国寺佛殿内',
        targetArea: 'temple_interior',
        x: -22,
        z: -48,
        radius: 4.5,
        spawnX: 0,
        spawnZ: 6.0,
        spawnYaw: Math.PI,
        kind: 'door',
      },
    ],
    npcs: [
      {
        id: 'bianliang_guard_l',
        name: '禁军门卫',
        title: '东京城门守将',
        role: 'guard',
        x: -5.5,
        z: 34,
        yaw: 0.2,
        interactable: true,
      },
      {
        id: 'bianliang_guard_r',
        name: '开封府巡卒',
        title: '宣德门值守',
        role: 'guard',
        x: 5.5,
        z: 34,
        yaw: -0.2,
        interactable: true,
      },
      {
        id: 'ruffian_zhangsan',
        name: '过街老鼠张三',
        title: '酸枣门外泼皮',
        role: 'ruffian',
        x: 15,
        z: -46,
        yaw: -0.8,
        interactable: true,
      },
      {
        id: 'ruffian_lisi',
        name: '青草蛇李四',
        title: '酸枣门外泼皮',
        role: 'ruffian',
        x: 24,
        z: -42,
        yaw: -2.2,
        interactable: true,
      },
      {
        id: 'bianliang_merchant_gate',
        name: '汴京茶商',
        title: '入城客商',
        role: 'merchant',
        x: 2.5,
        z: 56,
        yaw: Math.PI,
        interactable: true,
        patrol: [
          { x: 2.8, z: 58 },
          { x: 3.2, z: -24 },
        ],
        speed: 2.6,
      },
      {
        id: 'bianliang_citizen_gate',
        name: '出城书生',
        title: '太学举子',
        role: 'citizen',
        x: -2.8,
        z: 14,
        yaw: 0,
        interactable: true,
        patrol: [
          { x: -3.2, z: -22 },
          { x: -2.5, z: 58 },
        ],
        speed: 2.4,
      },
      {
        id: 'bianliang_peddler_1',
        name: '蜜饯货郎',
        title: '御街小贩',
        role: 'merchant',
        x: 11,
        z: 6,
        yaw: -1.4,
        interactable: true,
        patrol: [
          { x: 11, z: 14 },
          { x: 11, z: -20 },
        ],
        speed: 2.0,
      },
      {
        id: 'bianliang_citizen_2',
        name: '赏灯市民',
        title: '汴梁百姓',
        role: 'citizen',
        x: -10,
        z: -10,
        yaw: 1.0,
        interactable: true,
        patrol: [
          { x: -11, z: -20 },
          { x: -11, z: 14 },
        ],
        speed: 2.1,
      },
      {
        id: 'bianliang_citizen_3',
        name: '外城挑夫',
        title: '汴河脚夫',
        role: 'citizen',
        x: 14,
        z: 58,
        yaw: -1.5,
        interactable: true,
        patrol: [
          { x: 26, z: 58 },
          { x: -24, z: 58 },
        ],
        speed: 2.2,
      },
      {
        id: 'bianliang_patrol_street',
        name: '御街巡检',
        title: '开封府衙役',
        role: 'guard',
        x: 0,
        z: -28,
        yaw: 0,
        interactable: true,
        patrol: [
          { x: -20, z: -28 },
          { x: 20, z: -28 },
        ],
        speed: 2.1,
      },
    ],
    props: [
      {
        id: 'weeping_willow',
        label: '大相国寺垂杨柳 · 倒拔垂杨柳',
        x: 20,
        z: -48,
        radius: 6.0,
        actionType: 'uproot_willow',
      },
    ],
  },

  // ==========================================================================
  // 2 个建筑内部 (High-Precision 0.5-Unit Fine Voxel Interiors)
  // ==========================================================================
  tavern_interior: {
    id: 'tavern_interior',
    tier: 'interior',
    tierLabel: '建筑内部',
    name: '潘家酒楼 · 阁楼雅堂',
    subtitle: '红泥小坛、雕花木栏、暖灯酒案与金氏父女雅间',
    poem: '半窗灯火劝金樽，义气冲天闻哭声。',
    size: 16,
    defaultSpawn: { x: 0, z: 5.5, yaw: Math.PI },
    defaultTime: 'sunset',
    ambientHint: '可与史进饮酒畅谈，或在东侧雅间探问金翠莲哭声缘由。',
    waterLevel: null,
    isIndoor: true,
    portals: [
      {
        id: 'exit_tavern_weizhou',
        label: '推门返回 渭州·状元桥坊',
        targetArea: 'weizhou_town',
        x: 0,
        z: 12.6,
        radius: 3.2,
        spawnX: -10,
        spawnZ: -16,
        spawnYaw: 0,
        kind: 'door',
      },
    ],
    npcs: [
      {
        id: 'tavern_shijin',
        name: '史进',
        title: '九纹龙 · 华阴豪杰',
        role: 'shijin',
        x: -5.2,
        z: 0,
        yaw: 1.4,
        interactable: true,
      },
      {
        id: 'tavern_jincuilian',
        name: '金翠莲',
        title: '卖唱女子',
        role: 'jincuilian',
        x: 9.5,
        z: -4.5,
        yaw: -2.0,
        interactable: true,
      },
      {
        id: 'tavern_waiter',
        name: '酒保',
        title: '潘家酒楼小二',
        role: 'waiter',
        x: -1,
        z: -7.0,
        yaw: 0,
        interactable: true,
      },
    ],
    props: [
      {
        id: 'tavern_wine_table',
        label: '酒桌大坛 · 满饮三碗好酒',
        x: -5.2,
        z: 2.2,
        radius: 3.2,
        actionType: 'drink_wine',
      },
    ],
  },

  temple_interior: {
    id: 'temple_interior',
    tier: 'interior',
    tierLabel: '建筑内部',
    name: '文殊院 · 大雄宝殿内',
    subtitle: '金身如来、莲台背光、青烟香案与智真长老法座',
    poem: '遇林而起，遇山而富，遇水而兴，遇江而止。',
    size: 17,
    defaultSpawn: { x: 0, z: 6.0, yaw: Math.PI },
    defaultTime: 'dawn',
    ambientHint: '可在香案上香礼佛，或上前拜见智真长老剃度受戒、请领书信。',
    waterLevel: null,
    isIndoor: true,
    portals: [
      {
        id: 'exit_temple_wutai',
        label: '步出殿门至 五台山·文殊院',
        targetArea: 'wutai_temple',
        x: 0,
        z: 13.6,
        radius: 3.4,
        spawnX: 0,
        spawnZ: -14,
        spawnYaw: 0,
        kind: 'door',
      },
    ],
    npcs: [
      {
        id: 'abbot_zhizhen',
        name: '智真长老',
        title: '五台山文殊院住持',
        role: 'zhizhen',
        x: 0,
        z: -5.5,
        yaw: 0,
        interactable: true,
      },
      {
        id: 'hall_monk_left',
        name: '剃度师兄',
        title: '戒堂执事僧',
        role: 'monk',
        x: -6.8,
        z: -3.5,
        yaw: 0.7,
        interactable: true,
      },
    ],
    props: [
      {
        id: 'buddha_incense_altar',
        label: '佛前香案 · 焚香静心',
        x: 0,
        z: -1.5,
        radius: 3.4,
        actionType: 'offer_incense',
      },
    ],
  },
};

export function getNpcDialogue(npcId: string, flags: QuestFlags): DialogueNode {
  switch (npcId) {
    case 'lizhong_road':
      return {
        id: 'lizhong_1',
        speaker: '李忠',
        speakerTitle: '打虎将',
        text: flags.defeatedZhengTu
          ? '鲁提辖好身手！如今官府正在搜捕，哥哥速往东北五台山避祸才是上策！'
          : '鲁提辖！史进大郎方才已在前方渭州城状元桥旁的潘家酒楼订了座，正候着哥哥共饮两碗！',
        choices: [{ label: '好！洒家这就入渭州城寻史进兄弟去。', effect: 'close' }],
      };

    case 'tavern_shijin':
    case 'town_shijin':
      return {
        id: 'shijin_1',
        speaker: '史进',
        speakerTitle: '九纹龙',
        text: flags.heardJinCuilian
          ? '那郑屠竟如此欺凌良善！哥哥既有行侠之意，小弟这里备好银两助金老父女盘缠，哥哥放手去教训那厮！'
          : '久仰鲁提辖威名！快请满饮此碗关西老酒。只是方才听见隔壁雅间有女子啼哭不止，着实扫兴。',
        choices: [
          { label: '满饮一碗好酒！', effect: 'drink_tavern_wine' },
          { label: '洒家去东侧雅间问问那哭声缘由。', effect: 'close' },
        ],
      };

    case 'tavern_jincuilian':
      return {
        id: 'jin_1',
        speaker: '金翠莲',
        speakerTitle: '卖唱女子',
        text: flags.defeatedZhengTu
          ? '多谢鲁提辖大恩大德！听闻恶霸郑屠已伏诛，小女子父女已收拾细软连夜离城，恩公亦请速奔北山避祸！'
          : '官人明鉴！奴家本是东京人氏，随父来渭州投亲不遇，被状元桥下开肉铺的「镇关西」郑屠强媒硬娶，如今又被逐出讨要三千贯虚钱，日日逼迫，走投无路……',
        choices: [
          {
            label: '咄！一个卖肉的屠户也敢称镇关西？洒家这就去状元桥肉铺寻他！',
            effect: 'hear_jin_story',
          },
          { label: '休哭，待洒家与史进兄弟商议。', effect: 'close' },
        ],
      };

    case 'tavern_waiter':
      return {
        id: 'waiter_1',
        speaker: '酒保',
        speakerTitle: '潘家酒楼小二',
        text: '客官里边请！咱潘家酒楼的状元红最是醇厚，东厢房坐的是卖唱的金氏父女，西桌是史进大官人！',
        choices: [
          { label: '切二斤熟牛肉，筛一坛好酒来！', effect: 'drink_tavern_wine' },
          { label: '知道了，退下吧。', effect: 'close' },
        ],
      };

    case 'zhengtu':
      if (flags.defeatedZhengTu) {
        return {
          id: 'zheng_ko',
          speaker: '郑屠',
          speakerTitle: '镇关西（已伏地）',
          text: '好汉饶命……小的再不敢欺压金氏父女了……',
          choices: [{ label: '哼！洒家就此远走五台山。', effect: 'close' }],
        };
      }
      return {
        id: 'zheng_1',
        speaker: '郑屠',
        speakerTitle: '镇关西 · 肉铺恶霸',
        text: '原来是经略府的鲁提辖！要十斤精肉臊子、十斤肥肉臊子，还要十斤寸金软骨？莫不是特意来寻老子消遣的？！',
        choices: [
          {
            label: '洒家正是特意来消遣你！（三拳打倒镇关西）',
            effect: 'fight_zhengtu',
          },
          { label: '容洒家再看一眼你的肉案。', effect: 'close' },
        ],
      };

    case 'wine_peddler':
      return {
        id: 'peddler_1',
        speaker: '挑酒汉',
        speakerTitle: '五台山下酒贩',
        text: flags.drankMountainWine
          ? '师父好海量！一桶好酒眨眼便干，只是回文殊院切莫让监寺长老闻出酒气啊！'
          : '九里山前作战场，牧童拾得旧刀枪……师父莫拦，这担村酿是要挑给山上做工的汉子们喝的，长老有法旨不许卖给和尚！',
        choices: [
          {
            label: '休要罗唣！放下一贯钱，洒家先舀几瓢解解馋！（豪饮山酒）',
            effect: 'buy_mountain_wine',
          },
          { label: '也罢，洒家先上山去。', effect: 'close' },
        ],
      };

    case 'monk_jiansi':
      return {
        id: 'jiansi_1',
        speaker: '监寺首座',
        speakerTitle: '文殊院执事僧',
        text: flags.shookMountainGate
          ? '阿弥陀佛！智深师兄神力惊人，方才竟震得山门金刚泥屑纷飞，长老正在大雄宝殿内唤你前去叙话！'
          : flags.tookTonsure
            ? '智深师弟，出家人须守清规戒律，切不可下山饮酒生事！'
            : '阿弥陀佛，施主气宇轩昂，若欲拜见智真长老，请沿阶直入大雄宝殿。',
        choices: [{ label: '洒家省得了。', effect: 'close' }],
      };

    case 'abbot_zhizhen':
      if (!flags.tookTonsure) {
        return {
          id: 'zhizhen_tonsure',
          speaker: '智真长老',
          speakerTitle: '五台山文殊院住持',
          text: '善哉善哉！我看施主虽杀心未泯，却是上应天星，心地刚直，久后却得正果。老僧今日为你落发披缁，赐法名「智深」，你可愿皈依佛门？',
          choices: [
            {
              label: '多谢长老收留！洒家愿剃度为僧，法号鲁智深！',
              effect: 'take_tonsure',
            },
            { label: '容弟子在殿中再静思片刻。', effect: 'close' },
          ],
        };
      }
      if (!flags.receivedAbbotLetter) {
        return {
          id: 'zhizhen_letter',
          speaker: '智真长老',
          speakerTitle: '五台山文殊院住持',
          text: flags.drankMountainWine || flags.shookMountainGate
            ? '智深啊，你虽醉闹山门，本性不坏，只是五台清凉地难容你这般烈性。老僧修书一封，荐你前往东京汴梁城「大相国寺」投奔智清禅师，并赠你四句偈言：「遇林而起，遇山而富，遇水而兴，遇江而止。」'
            : '智深既已剃度，不妨在五台山中走动体悟；若动身意愿已决，老僧亦可修书荐你前往东京汴梁大相国寺。',
          choices: [
            {
              label: '弟子拜谢长老偈言与荐书！这就下山往东京汴梁去！',
              effect: 'receive_letter',
            },
            { label: '弟子再去山间半山亭走一遭。', effect: 'close' },
          ],
        };
      }
      return {
        id: 'zhizhen_done',
        speaker: '智真长老',
        speakerTitle: '五台山文殊院住持',
        text: '切记四句偈言：遇林而起，遇山而富，遇水而兴，遇江而止。东京汴梁繁华似锦，去大相国寺好生修行吧。',
        choices: [{ label: '弟子谨记在心，就此拜别长老！', effect: 'close' }],
      };

    case 'ruffian_zhangsan':
    case 'ruffian_lisi':
      return {
        id: 'ruffian_1',
        speaker: npcId === 'ruffian_zhangsan' ? '过街老鼠张三' : '青草蛇李四',
        speakerTitle: '酸枣门外泼皮',
        text: flags.uprootedWillow
          ? '师父真乃天人下凡！连这百年大垂杨柳都连根拔起，俺们二三十个泼皮从此死心塌地拜师父为尊！'
          : '哟，这不是大相国寺新派来管菜园的和尚么？树上老鸦聒噪得紧，师父若有本事，莫非能把这棵大垂杨柳拔起来不成？',
        choices: [
          {
            label: '看洒家神力！（相国寺倒拔垂杨柳）',
            effect: 'uproot_willow_action',
          },
          { label: '且退开几步，待洒家走近柳树试试！', effect: 'close' },
        ],
      };

    case 'bianliang_guard_l':
    case 'bianliang_guard_r':
      return {
        id: 'guard_bl',
        speaker: '禁军门卫',
        speakerTitle: '东京宣德门守将',
        text: '此处乃大宋东京汴梁城门！入城便是十里御街，樊楼酒香飘十里；穿街向北可抵皇家寺院大相国寺与菜园。师父请行！',
        choices: [{ label: '多谢军爷指引。', effect: 'close' }],
      };

    default:
      return {
        id: 'generic_npc',
        speaker: '路人',
        speakerTitle: '大宋百姓',
        text: '这位好汉器宇不凡！如今大宋山河壮丽，渭州边风苍劲，五台松涛万里，东京汴梁更是车水马龙、烟火繁华！',
        choices: [{ label: '告辞。', effect: 'close' }],
      };
  }
}
