const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const EMU = 914400;
const SLIDE_W = 12192000;
const SLIDE_H = 6858000;

const OUT_DIR = path.join(__dirname, '..', 'output');
const OUT_FILE = path.join(OUT_DIR, '兴利汽车模具_系统功能点介绍_2026-06-05.pptx');

function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function emu(inches) {
  return Math.round(inches * EMU);
}

function paragraph(text, opts = {}) {
  const size = opts.size || 2000;
  const color = opts.color || '2B4C74';
  const bold = opts.bold ? '<a:rPr lang="zh-CN" sz="' + size + '" b="1" dirty="0" smtClean="0"><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/></a:rPr>' : '<a:rPr lang="zh-CN" sz="' + size + '" dirty="0" smtClean="0"><a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/></a:rPr>';
  const pPr = opts.bullet
    ? '<a:pPr marL="228600" indent="-228600"><a:buChar char="•"/></a:pPr>'
    : (opts.center ? '<a:pPr algn="ctr"/>' : '<a:pPr/>');
  return `<a:p>${pPr}<a:r>${bold}<a:t>${esc(text)}</a:t></a:r>${opts.endParaRPr === false ? '' : `<a:endParaRPr lang="zh-CN" sz="${size}"/>`}</a:p>`;
}

function shape(id, name, x, y, cx, cy, opts = {}) {
  const preset = opts.preset || 'roundRect';
  const fill = opts.fill === 'none'
    ? '<a:noFill/>'
    : `<a:solidFill><a:srgbClr val="${opts.fill || 'FFFFFF'}"/></a:solidFill>`;
  const line = opts.line === 'none'
    ? '<a:ln><a:noFill/></a:ln>'
    : `<a:ln w="${opts.lineW || 12700}"><a:solidFill><a:srgbClr val="${opts.line || 'D8E8F8'}"/></a:solidFill></a:ln>`;
  const bodyPr = opts.bodyPr || '<a:bodyPr wrap="square" lIns="91440" tIns="68580" rIns="91440" bIns="68580" anchor="t"/>';
  const paras = (opts.paragraphs || []).join('');
  return `
  <p:sp>
    <p:nvSpPr>
      <p:cNvPr id="${id}" name="${esc(name)}"/>
      <p:cNvSpPr txBox="${opts.textBox ? '1' : '0'}"/>
      <p:nvPr/>
    </p:nvSpPr>
    <p:spPr>
      <a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
      <a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>
      ${fill}
      ${line}
    </p:spPr>
    <p:txBody>
      ${bodyPr}
      <a:lstStyle/>
      ${paras}
    </p:txBody>
  </p:sp>`;
}

function accentBar(id, color) {
  return shape(id, 'Accent Bar', 0, 0, SLIDE_W, emu(0.18), {
    preset: 'rect',
    fill: color,
    line: 'none',
    paragraphs: ['<a:p><a:endParaRPr lang="zh-CN"/></a:p>']
  });
}

function slideXml(parts) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg>
      <p:bgPr>
        <a:solidFill><a:srgbClr val="F6FAFF"/></a:solidFill>
        <a:effectLst/>
      </p:bgPr>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
      ${parts.join('\n')}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

const slides = [];

slides.push(slideXml([
  accentBar(2, '3E8EDC'),
  shape(3, 'Title', emu(0.8), emu(0.9), emu(8.2), emu(1.4), {
    fill: 'none',
    line: 'none',
    textBox: true,
    bodyPr: '<a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"/>',
    paragraphs: [
      paragraph('兴利汽车模具数字化管理系统', { size: 3000, color: '1F4E79', bold: true }),
      paragraph('当前设计功能点介绍', { size: 2000, color: '5F84A6', bold: false })
    ]
  }),
  shape(4, 'Sub', emu(0.82), emu(2.55), emu(7.8), emu(0.7), {
    fill: 'none',
    line: 'none',
    textBox: true,
    bodyPr: '<a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"/>',
    paragraphs: [
      paragraph('基于当前代码、管理后台页面与移动端页面梳理', { size: 1400, color: '6D8AA8' }),
      paragraph('范围覆盖：管理员后台、员工端、6S闭环、反馈、报餐、投票、培训、权限与待办', { size: 1400, color: '6D8AA8' })
    ]
  }),
  shape(5, 'Card', emu(8.9), emu(0.95), emu(3.45), emu(4.85), {
    fill: 'EAF4FF',
    line: 'D9EAFB',
    paragraphs: [
      paragraph('讲解建议', { size: 1600, color: '2E6C97', bold: true }),
      paragraph('1. 先讲系统定位', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('2. 再讲后台模块', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('3. 重点展开 6S 管理闭环', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('4. 最后讲权限、提醒与后续规划', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('', { size: 1200, color: '4C6782', endParaRPr: false }),
      paragraph('版本日期：2026-06-05', { size: 1200, color: '7C97B3' })
    ]
  })
]));

slides.push(slideXml([
  accentBar(2, '56A6E7'),
  shape(3, 'Title', emu(0.7), emu(0.42), emu(5.5), emu(0.55), {
    fill: 'none',
    line: 'none',
    textBox: true,
    paragraphs: [paragraph('1. 系统定位与使用角色', { size: 2200, color: '1F4E79', bold: true })]
  }),
  shape(4, 'Card1', emu(0.7), emu(1.2), emu(3.9), emu(4.8), {
    fill: 'FFFFFF',
    line: 'D8E8F8',
    paragraphs: [
      paragraph('系统定位', { size: 1700, color: '2E6C97', bold: true }),
      paragraph('覆盖企业日常管理、员工服务与现场 6S 闭环。', { size: 1400, color: '4C6782' }),
      paragraph('当前已形成“后台管理 + 员工移动端 + 消息提醒”的一体化结构。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('适合现场管理、行政流程和数据留痕同步推进。', { size: 1400, color: '4C6782', bullet: true })
    ]
  }),
  shape(5, 'Card2', emu(4.7), emu(1.2), emu(3.55), emu(4.8), {
    fill: 'FFFFFF',
    line: 'D8E8F8',
    paragraphs: [
      paragraph('使用角色', { size: 1700, color: '2E6C97', bold: true }),
      paragraph('管理员', { size: 1450, color: '24476E', bold: true, bullet: true }),
      paragraph('负责后台配置、审批、统计、文件与权限管理。', { size: 1350, color: '4C6782' }),
      paragraph('员工 / 学生', { size: 1450, color: '24476E', bold: true, bullet: true }),
      paragraph('通过工号+姓名进入员工端，使用报餐、培训、投票、反馈、待办等功能。', { size: 1350, color: '4C6782' })
    ]
  }),
  shape(6, 'Card3', emu(8.45), emu(1.2), emu(3.0), emu(4.8), {
    fill: 'EAF4FF',
    line: 'D8E8F8',
    paragraphs: [
      paragraph('数据基础', { size: 1700, color: '2E6C97', bold: true }),
      paragraph('员工表 staff', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('学生名册 student_roster', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('6S 记录与审核日志', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('通知 / 待办 / 权限配置', { size: 1400, color: '4C6782', bullet: true })
    ]
  })
]));

slides.push(slideXml([
  accentBar(2, '5CAFE2'),
  shape(3, 'Title', emu(0.7), emu(0.42), emu(6), emu(0.55), {
    fill: 'none', line: 'none', textBox: true,
    paragraphs: [paragraph('2. 管理员后台功能模块', { size: 2200, color: '1F4E79', bold: true })]
  }),
  shape(4, 'Body', emu(0.75), emu(1.1), emu(12.0), emu(5.7), {
    fill: 'FFFFFF', line: 'D8E8F8',
    paragraphs: [
      paragraph('后台首页入口模块', { size: 1650, color: '2E6C97', bold: true }),
      paragraph('员工管理：员工资料、部门、状态、基础数据维护。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('培训管理：试卷、考试记录、学习任务、成绩统计。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('报餐系统：活动、菜单、统计、员工报餐记录。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('投票系统：活动创建、投票结果、匿名/非匿名统计。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('6S管理：曝光、整改、复核、汇总看板、案例查看。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('权限管理：模块权限、6S 权限、文件权限、批量导入。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('文件管理：上传、下载、批量文件管理、权限约束。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('个人待办 / 站内消息 / 问题反馈：构成后台运营协同能力。', { size: 1400, color: '4C6782', bullet: true })
    ]
  })
]));

slides.push(slideXml([
  accentBar(2, '64B5C9'),
  shape(3, 'Title', emu(0.7), emu(0.42), emu(5.8), emu(0.55), {
    fill: 'none', line: 'none', textBox: true,
    paragraphs: [paragraph('3. 员工端与移动端能力', { size: 2200, color: '1F4E79', bold: true })]
  }),
  shape(4, 'Left', emu(0.75), emu(1.15), emu(5.65), emu(5.5), {
    fill: 'FFFFFF', line: 'D8E8F8',
    paragraphs: [
      paragraph('员工登录与首页', { size: 1650, color: '2E6C97', bold: true }),
      paragraph('工号 + 姓名登录，兼容正式员工与实训生。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('员工首页集成报餐、培训、投票、反馈、待办等入口。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('员工普通页面支持 7 天登录有效期。', { size: 1400, color: '4C6782', bullet: true })
    ]
  }),
  shape(5, 'Right', emu(6.6), emu(1.15), emu(5.6), emu(5.5), {
    fill: 'EAF4FF', line: 'D8E8F8',
    paragraphs: [
      paragraph('模块级访问控制', { size: 1650, color: '2E6C97', bold: true }),
      paragraph('6S管理 / 我的待办 支持独立二次验证。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('同设备、同一天首次进入时，可要求管理员密码验证。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('6S任务页面按 7 天员工登录态管理，不强制当天二次密码。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('移动端页面已覆盖 6S 列表、6S 详情、6S 任务、待办等关键页面。', { size: 1400, color: '4C6782', bullet: true })
    ]
  })
]));

slides.push(slideXml([
  accentBar(2, '48A2E2'),
  shape(3, 'Title', emu(0.7), emu(0.42), emu(6.4), emu(0.55), {
    fill: 'none', line: 'none', textBox: true,
    paragraphs: [paragraph('4. 6S 管理闭环功能点', { size: 2200, color: '1F4E79', bold: true })]
  }),
  shape(4, 'Flow', emu(0.7), emu(1.1), emu(12.0), emu(5.8), {
    fill: 'FFFFFF', line: 'D8E8F8',
    paragraphs: [
      paragraph('流程闭环', { size: 1650, color: '2E6C97', bold: true }),
      paragraph('曝光创建：区域、问题描述、责任人、检查日期、截止日期、整改前照片。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('责任人整改：上传整改后照片，提交进入待审核。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('管理员复核整改：待整改阶段可直接上传整改后照片并执行已达标 / 未达标。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('未达标追踪：累计打回次数、历史整改照片、审核意见留痕。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('汇总能力：6S 列表、运行汇报、案例查看、曝光趋势。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('协同能力：管理员之间共享近 15 天 6S 数据，移动端和 PC 端逻辑同步。', { size: 1400, color: '4C6782', bullet: true })
    ]
  })
]));

slides.push(slideXml([
  accentBar(2, '4DB1E1'),
  shape(3, 'Title', emu(0.7), emu(0.42), emu(7.0), emu(0.55), {
    fill: 'none', line: 'none', textBox: true,
    paragraphs: [paragraph('5. 权限、会话与提醒机制', { size: 2200, color: '1F4E79', bold: true })]
  }),
  shape(4, 'Body', emu(0.75), emu(1.15), emu(12.0), emu(5.5), {
    fill: 'FFFFFF', line: 'D8E8F8',
    paragraphs: [
      paragraph('管理员登录态', { size: 1600, color: '2E6C97', bold: true }),
      paragraph('管理员后台登录成功后，当天内免再次输入密码。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('员工登录态', { size: 1600, color: '2E6C97', bold: true }),
      paragraph('员工普通页面 7 天有效；过期后自动返回登录页。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('模块级验证', { size: 1600, color: '2E6C97', bold: true }),
      paragraph('对指定模块单独验证管理员密码，支持同设备当天免重复验证。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('提醒与通知', { size: 1600, color: '2E6C97', bold: true }),
      paragraph('6S 审核、整改、提交、复核等关键节点可生成站内通知与界面提醒。', { size: 1400, color: '4C6782', bullet: true })
    ]
  })
]));

slides.push(slideXml([
  accentBar(2, '6EBCD8'),
  shape(3, 'Title', emu(0.7), emu(0.42), emu(6.6), emu(0.55), {
    fill: 'none', line: 'none', textBox: true,
    paragraphs: [paragraph('6. 运营支撑与协同能力', { size: 2200, color: '1F4E79', bold: true })]
  }),
  shape(4, 'Left', emu(0.75), emu(1.15), emu(5.75), emu(5.45), {
    fill: 'FFFFFF', line: 'D8E8F8',
    paragraphs: [
      paragraph('问题反馈', { size: 1650, color: '2E6C97', bold: true }),
      paragraph('用户提交问题、管理员回复、处理状态跟踪。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('个人待办', { size: 1650, color: '2E6C97', bold: true }),
      paragraph('记录个人事项、分派任务、查看到期和逾期。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('站内消息', { size: 1650, color: '2E6C97', bold: true }),
      paragraph('后台首页集中显示未读、任务消息和业务提醒。', { size: 1400, color: '4C6782', bullet: true })
    ]
  }),
  shape(5, 'Right', emu(6.45), emu(1.15), emu(5.75), emu(5.45), {
    fill: 'EAF4FF', line: 'D8E8F8',
    paragraphs: [
      paragraph('导入导出与配置', { size: 1650, color: '2E6C97', bold: true }),
      paragraph('支持 CSV / Excel 导出、区域模板、权限批量导入。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('文件管理与共享', { size: 1650, color: '2E6C97', bold: true }),
      paragraph('支持文件权限、公共/个人文件管理与 SMB 同步能力。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('后台首页', { size: 1650, color: '2E6C97', bold: true }),
      paragraph('已具备系统入口、趋势图、业务概览、提醒与个人工作台等总控能力。', { size: 1400, color: '4C6782', bullet: true })
    ]
  })
]));

slides.push(slideXml([
  accentBar(2, '3E8EDC'),
  shape(3, 'Title', emu(0.7), emu(0.55), emu(7.2), emu(0.65), {
    fill: 'none', line: 'none', textBox: true,
    paragraphs: [paragraph('7. 当前阶段价值与后续可优化方向', { size: 2200, color: '1F4E79', bold: true })]
  }),
  shape(4, 'Left', emu(0.75), emu(1.45), emu(5.7), emu(4.9), {
    fill: 'FFFFFF', line: 'D8E8F8',
    paragraphs: [
      paragraph('当前价值', { size: 1650, color: '2E6C97', bold: true }),
      paragraph('已经形成“业务功能 + 移动端 + 权限控制 + 留痕追踪”的完整管理底座。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('6S 管理从曝光、整改、复核到汇总已具备完整闭环。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('后台首页已可作为管理驾驶舱的基础版本。', { size: 1400, color: '4C6782', bullet: true })
    ]
  }),
  shape(5, 'Right', emu(6.45), emu(1.45), emu(5.7), emu(4.9), {
    fill: 'EAF4FF', line: 'D8E8F8',
    paragraphs: [
      paragraph('后续建议', { size: 1650, color: '2E6C97', bold: true }),
      paragraph('继续优化 dashboard 的布局层级与视觉识别度。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('强化 6S 统计分析，如达标率、逾期率、区域排名。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('打通更多跨模块待处理中心，让消息、待办、反馈更集中。', { size: 1400, color: '4C6782', bullet: true }),
      paragraph('完善汇报演示材料，形成对外展示和内部培训统一版本。', { size: 1400, color: '4C6782', bullet: true })
    ]
  })
]));

function slideRel() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;
}

function contentTypes(slideCount) {
  let overrides = `
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`;
  for (let i = 1; i <= slideCount; i += 1) {
    overrides += `\n  <Override PartName="/ppt/slides/slide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`;
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${overrides}
</Types>`;
}

function rootRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function appXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>OpenAI Codex</Application>
  <PresentationFormat>On-screen Show (16:9)</PresentationFormat>
  <Slides>${slides.length}</Slides>
  <Notes>0</Notes>
  <HiddenSlides>0</HiddenSlides>
  <MMClips>0</MMClips>
  <ScaleCrop>false</ScaleCrop>
  <Company>兴利汽车模具</Company>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>16.0000</AppVersion>
</Properties>`;
}

function coreXml() {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>兴利汽车模具系统功能点介绍</dc:title>
  <dc:creator>OpenAI Codex</dc:creator>
  <cp:lastModifiedBy>OpenAI Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

function presentationXml(slideCount) {
  let sldIds = '';
  for (let i = 1; i <= slideCount; i += 1) {
    sldIds += `<p:sldId id="${255 + i}" r:id="rId${i + 1}"/>`;
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1" autoCompressPictures="0">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${sldIds}</p:sldIdLst>
  <p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}" type="screen16x9"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;
}

function presentationRels(slideCount) {
  let rels = `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`;
  for (let i = 1; i <= slideCount; i += 1) {
    rels += `\n  <Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i}.xml"/>`;
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rels}
</Relationships>`;
}

function slideMasterXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld name="Blank Master">
    <p:bg>
      <p:bgPr>
        <a:solidFill><a:srgbClr val="F6FAFF"/></a:solidFill>
        <a:effectLst/>
      </p:bgPr>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst>
  <p:txStyles>
    <p:titleStyle/>
    <p:bodyStyle/>
    <p:otherStyle/>
  </p:txStyles>
</p:sldMaster>`;
}

function slideMasterRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;
}

function slideLayoutXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank Layout">
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;
}

function slideLayoutRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;
}

function themeXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
  <a:themeElements>
    <a:clrScheme name="Custom">
      <a:dk1><a:srgbClr val="000000"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F4E79"/></a:dk2>
      <a:lt2><a:srgbClr val="EAF4FF"/></a:lt2>
      <a:accent1><a:srgbClr val="3E8EDC"/></a:accent1>
      <a:accent2><a:srgbClr val="56A6E7"/></a:accent2>
      <a:accent3><a:srgbClr val="5CAFE2"/></a:accent3>
      <a:accent4><a:srgbClr val="64B5C9"/></a:accent4>
      <a:accent5><a:srgbClr val="6EBCD8"/></a:accent5>
      <a:accent6><a:srgbClr val="7FCAE4"/></a:accent6>
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
      <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Custom">
      <a:majorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Microsoft YaHei"/></a:majorFont>
      <a:minorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Microsoft YaHei"/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Custom">
      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
  <a:objectDefaults/>
  <a:extraClrSchemeLst/>
</a:theme>`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const zip = new JSZip();

  zip.file('[Content_Types].xml', contentTypes(slides.length));
  zip.folder('_rels').file('.rels', rootRels());
  zip.folder('docProps').file('app.xml', appXml());
  zip.folder('docProps').file('core.xml', coreXml());
  zip.folder('ppt').file('presentation.xml', presentationXml(slides.length));
  zip.folder('ppt').folder('_rels').file('presentation.xml.rels', presentationRels(slides.length));
  zip.folder('ppt').folder('slideMasters').file('slideMaster1.xml', slideMasterXml());
  zip.folder('ppt').folder('slideMasters').folder('_rels').file('slideMaster1.xml.rels', slideMasterRels());
  zip.folder('ppt').folder('slideLayouts').file('slideLayout1.xml', slideLayoutXml());
  zip.folder('ppt').folder('slideLayouts').folder('_rels').file('slideLayout1.xml.rels', slideLayoutRels());
  zip.folder('ppt').folder('theme').file('theme1.xml', themeXml());

  const slideFolder = zip.folder('ppt').folder('slides');
  const slideRelFolder = zip.folder('ppt').folder('slides').folder('_rels');
  slides.forEach((xml, idx) => {
    const n = idx + 1;
    slideFolder.file(`slide${n}.xml`, xml);
    slideRelFolder.file(`slide${n}.xml.rels`, slideRel());
  });

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(OUT_FILE, buf);
  console.log(OUT_FILE);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
