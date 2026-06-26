const RULE_TEMPLATES = {
  office_standard: {
    key: 'office_standard',
    label: '职能标准',
    summer: { enabled: true, firstCycleYears: 1, firstCycleQty: 2, cycleYears: 1, cycleQty: 1 },
    winter: { enabled: true, firstCycleYears: 2, firstCycleQty: 2, cycleYears: 2, cycleQty: 1 },
    shoes: { enabled: false, firstCycleYears: 0, firstCycleQty: 0, cycleYears: 0, cycleQty: 0 }
  },
  summer_shop_no_shoes: {
    key: 'summer_shop_no_shoes',
    label: '车夏无鞋',
    summer: { enabled: true, firstCycleYears: 1, firstCycleQty: 2, cycleYears: 1, cycleQty: 1 },
    winter: { enabled: true, firstCycleYears: 2, firstCycleQty: 2, cycleYears: 2, cycleQty: 1 },
    shoes: { enabled: false, firstCycleYears: 0, firstCycleQty: 0, cycleYears: 0, cycleQty: 0 }
  },
  summer_shop_with_shoes: {
    key: 'summer_shop_with_shoes',
    label: '车夏带鞋',
    summer: { enabled: true, firstCycleYears: 1, firstCycleQty: 2, cycleYears: 1, cycleQty: 1 },
    winter: { enabled: true, firstCycleYears: 2, firstCycleQty: 2, cycleYears: 2, cycleQty: 1 },
    shoes: { enabled: true, firstCycleYears: 1, firstCycleQty: 2, cycleYears: 1, cycleQty: 1 }
  },
  frontline_full: {
    key: 'frontline_full',
    label: '一线标准',
    summer: { enabled: true, firstCycleYears: 1, firstCycleQty: 2, cycleYears: 1, cycleQty: 2 },
    winter: { enabled: true, firstCycleYears: 1, firstCycleQty: 2, cycleYears: 1, cycleQty: 1 },
    shoes: { enabled: true, firstCycleYears: 1, firstCycleQty: 2, cycleYears: 1, cycleQty: 1 }
  }
};

const POSITION_RULE_KEY = {
  '副总': 'office_standard',
  '迈卡蒂': 'office_standard',
  '总经理': 'office_standard',
  '技术副总经理': 'office_standard',
  '财务总监': 'office_standard',
  '财务部长': 'office_standard',
  '出纳': 'office_standard',
  '会计': 'office_standard',
  '助理会计': 'office_standard',
  '行政部长': 'office_standard',
  '信息化运维': 'office_standard',
  '行政专员': 'office_standard',
  '人事行政助理': 'office_standard',
  '驾驶员': 'office_standard',
  '市场部长': 'office_standard',
  '报价专员': 'office_standard',
  '单证员': 'office_standard',
  '项目部长': 'office_standard',
  '项目工程师': 'office_standard',
  '项目助理': 'office_standard',
  '技术总工程师': 'office_standard',
  '技术分析组长': 'office_standard',
  '高级技术分析师': 'office_standard',
  '中级技术分析师': 'office_standard',
  '初级技术分析师': 'office_standard',
  '模流组长': 'office_standard',
  '模流助理工程师': 'office_standard',
  '技术部长': 'office_standard',
  '技术文员': 'office_standard',
  '3D设计组长': 'office_standard',
  '3D高级设计师': 'office_standard',
  '3D中级设计师': 'office_standard',
  '3D初级设计师': 'office_standard',
  '3D助理设计师': 'office_standard',
  '2D设计师': 'office_standard',
  '品质部长': 'office_standard',
  '采购组长': 'office_standard',
  '采购员': 'office_standard',
  '零星采购兼物流员': 'office_standard',
  '采购助理': 'office_standard',
  '生产部长': 'office_standard',
  '外协主管': 'office_standard',
  '设备科长': 'office_standard',
  '工艺计划员': 'office_standard',
  '工艺工程师': 'office_standard',
  '工艺学徒': 'office_standard',
  'CNC组长': 'office_standard',
  '数控铣编程': 'office_standard',
  '数控铣编程学徒': 'office_standard',
  '深孔钻组长': 'office_standard',
  '电极设计师': 'office_standard',
  '电极设计学徒': 'office_standard',
  '注塑部长': 'office_standard',
  '制品部长': 'office_standard',
  '生产计划员': 'office_standard',
  '五金仓管员': 'summer_shop_no_shoes',
  '刀具仓管员': 'summer_shop_no_shoes',
  '制品仓管员': 'summer_shop_no_shoes',
  '杂工': 'summer_shop_no_shoes',
  '白班保安': 'summer_shop_no_shoes',
  '夜班保安': 'summer_shop_no_shoes',
  '保洁员': 'summer_shop_no_shoes',
  '品质工程师': 'summer_shop_no_shoes',
  '品质助理工程师': 'summer_shop_no_shoes',
  '三坐标测量员': 'summer_shop_no_shoes',
  '三坐标测量学徒': 'summer_shop_no_shoes',
  '注塑工': 'summer_shop_no_shoes',
  '质检员': 'summer_shop_no_shoes',
  '电工': 'summer_shop_with_shoes',
  '注塑领班': 'summer_shop_with_shoes',
  '试模调机': 'summer_shop_with_shoes',
  '试模调机学徒': 'summer_shop_with_shoes',
  '高速铣作业员': 'frontline_full',
  '五轴3+2作业员': 'frontline_full',
  '数控铣作业员': 'frontline_full',
  '数控铣学徒': 'frontline_full',
  '刀具管理员': 'frontline_full',
  '深孔钻作业员': 'frontline_full',
  '电火花组长': 'frontline_full',
  '电火花作业员': 'frontline_full',
  '铣磨作业员': 'frontline_full',
  '线切割作业员': 'frontline_full',
  '摇臂钻作业员': 'frontline_full',
  '抛光组长': 'frontline_full',
  '抛光员': 'frontline_full',
  '抛光学徒': 'frontline_full',
  '钳工组长': 'frontline_full',
  '钳工师傅': 'frontline_full',
  '钳工普师': 'frontline_full',
  '钳工学徒': 'frontline_full',
  '研配组长': 'frontline_full'
};

function parseDateOnly(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateOnly(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addYears(date, years) {
  const next = new Date(date.getTime());
  next.setFullYear(next.getFullYear() + years);
  return next;
}

function getCycleWindow(rule, hireDate, referenceDate) {
  if (!rule?.enabled || !hireDate || !referenceDate) return null;
  if (referenceDate < hireDate) return null;

  const firstCycleEnd = addYears(hireDate, rule.firstCycleYears);
  if (referenceDate < firstCycleEnd) {
    return {
      cycleStart: hireDate,
      cycleEnd: firstCycleEnd,
      allowedQty: rule.firstCycleQty
    };
  }

  let cycleStart = firstCycleEnd;
  let cycleEnd = addYears(cycleStart, rule.cycleYears);
  while (referenceDate >= cycleEnd) {
    cycleStart = cycleEnd;
    cycleEnd = addYears(cycleStart, rule.cycleYears);
  }

  return {
    cycleStart,
    cycleEnd,
    allowedQty: rule.cycleQty
  };
}

function getIssueCategory(itemName) {
  const name = String(itemName || '').trim();
  if (!name) return '';
  if (name.includes('鞋')) return 'shoes';
  if (name.includes('夏')) return 'summer';
  if (name.includes('春秋') || name.includes('冬')) return 'winter';
  return '';
}

function getRuleByPosition(position) {
  const key = POSITION_RULE_KEY[String(position || '').trim()];
  return key ? RULE_TEMPLATES[key] : null;
}

function calculateAvailability({ position, hireDate, referenceDate, issueRows }) {
  const rule = getRuleByPosition(position);
  const normalizedHireDate = parseDateOnly(hireDate);
  const normalizedReferenceDate = parseDateOnly(referenceDate) || new Date();
  const rows = Array.isArray(issueRows) ? issueRows : [];

  const categories = ['summer', 'winter', 'shoes'];
  const available = { summer: 0, winter: 0, shoes: 0 };
  const details = {};

  if (!rule || !normalizedHireDate) {
    categories.forEach((category) => {
      details[category] = {
        enabled: !!rule?.[category]?.enabled,
        allowedQty: 0,
        claimedQty: 0,
        cycleStart: '',
        cycleEnd: ''
      };
    });
    return {
      matched: !!rule,
      ruleKey: rule?.key || '',
      ruleLabel: rule?.label || '',
      available,
      details
    };
  }

  categories.forEach((category) => {
    const config = rule[category];
    const window = getCycleWindow(config, normalizedHireDate, normalizedReferenceDate);
    if (!config?.enabled || !window) {
      details[category] = {
        enabled: false,
        allowedQty: 0,
        claimedQty: 0,
        cycleStart: '',
        cycleEnd: ''
      };
      available[category] = 0;
      return;
    }

    const claimedQty = rows
      .filter((row) => getIssueCategory(row.item_name) === category)
      .filter((row) => {
        const issueDate = parseDateOnly(row.issue_date);
        return issueDate && issueDate >= window.cycleStart && issueDate < window.cycleEnd;
      })
      .reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);

    const remaining = Math.max(window.allowedQty - claimedQty, 0);
    available[category] = remaining;
    details[category] = {
      enabled: true,
      allowedQty: window.allowedQty,
      claimedQty,
      cycleStart: formatDateOnly(window.cycleStart),
      cycleEnd: formatDateOnly(window.cycleEnd)
    };
  });

  return {
    matched: true,
    ruleKey: rule.key,
    ruleLabel: rule.label,
    available,
    details
  };
}

module.exports = {
  getRuleByPosition,
  calculateAvailability,
  getIssueCategory
};
