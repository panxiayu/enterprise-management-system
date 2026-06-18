// src/models/database.js
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// 数据文件路径 - 使用绝对路径，基于当前文件位置
const dbPath = path.resolve(__dirname, '../../data/exam.db');

// 确保数据目录存在
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

console.log('📁 数据库路径:', dbPath, 'CWD:', process.cwd());

// 连接数据库
let db;
try {
  db = new Database(dbPath);
  console.log('✅ 数据库连接成功');
} catch (err) {
  console.error('❌ 数据库连接失败:', err.message);
  process.exit(1);
}

// 启用外键约束
db.pragma('foreign_keys = ON');

// 初始化数据库（如果不存在则创建表）
function initDatabase() {
  try {
    console.log('🔧 初始化数据库...');

    // 检查是否已初始化
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all();

    if (tables.length > 0) {
      console.log('✅ 数据库已初始化，表数:', tables.length);
      // 初始化后续检查（如新增字段/表）
      initUsersColumns();
      initMealActivitiesColumns();
      initMealSignupsColumns();
      initVotingTables();
      initPermissionLogsTable();
      initFeedbackTable();
      initStaffNamePinyin();
      initStudentRoster();
      initSixSRecords();
      initTaskWorkbench();
      initNotificationCenter();
      initMiniAppIntegration();
      migrateTimestampsToLocaltime();
      return;
    }

    // 读取 SQL 初始化脚本
    const sqlPath = path.join(__dirname, '../../data/init.sql');
    if (fs.existsSync(sqlPath)) {
      console.log(`📄 执行初始化脚本: init.sql`);
      const sql = fs.readFileSync(sqlPath, 'utf-8');
      db.exec(sql);
      console.log('✅ 数据库初始化完成');
      // 初始化后续检查
      initUsersColumns();
      initMealActivitiesColumns();
      initVotingTables();
      initPermissionLogsTable();
      initFeedbackTable();
      initStaffNamePinyin();
      initStudentRoster();
      initSixSRecords();
      initTaskWorkbench();
      initNotificationCenter();
      initMiniAppIntegration();
      migrateTimestampsToLocaltime();
    } else {
      console.error('❌ 未找到 init.sql');
      throw new Error('初始化脚本不存在');
    }
  } catch (err) {
    console.error('❌ 数据库初始化失败:', err.message);
    throw err;
  }
}

// 初始化 users 表缺失的列
function initUsersColumns() {
  try {
    const columns = db.prepare("PRAGMA table_info(users)").all();
    const columnNames = columns.map(c => c.name);

    if (!columnNames.includes('status')) {
      db.exec("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'");
      console.log('✅ users 表新增 status 字段');
    }
    if (!columnNames.includes('can_manage_file')) {
      db.exec("ALTER TABLE users ADD COLUMN can_manage_file INTEGER DEFAULT 0");
      console.log('✅ users 表新增 can_manage_file 字段');
    }
    if (!columnNames.includes('can_manage_training')) {
      db.exec("ALTER TABLE users ADD COLUMN can_manage_training INTEGER DEFAULT 0");
      console.log('✅ users 表新增 can_manage_training 字段');
    }
    if (!columnNames.includes('can_manage_6s')) {
      db.exec("ALTER TABLE users ADD COLUMN can_manage_6s INTEGER DEFAULT 0");
      console.log('✅ users 表新增 can_manage_6s 字段');
    }
    if (!columnNames.includes('can_manage_permission')) {
      db.exec("ALTER TABLE users ADD COLUMN can_manage_permission INTEGER DEFAULT 0");
      console.log('✅ users 表新增 can_manage_permission 字段');
    }
    if (!columnNames.includes('can_manage_feedback')) {
      db.exec("ALTER TABLE users ADD COLUMN can_manage_feedback INTEGER DEFAULT 0");
      console.log('✅ users 表新增 can_manage_feedback 字段');
    }
  } catch (err) {
    console.error('❌ initUsersColumns 失败:', err.message);
  }
}

// 初始化 meal_signups_v4 表缺失的列
function initMealSignupsColumns() {
  try {
    const columns = db.prepare("PRAGMA table_info(meal_signups_v4)").all();
    const columnNames = columns.map(c => c.name);

    if (!columnNames.includes('is_temporary')) {
      db.exec("ALTER TABLE meal_signups_v4 ADD COLUMN is_temporary INTEGER DEFAULT 0");
      console.log('✅ meal_signups_v4 表新增 is_temporary 字段');
    }

    // 检查触发器是否已存在
    const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='fix_meal_signup_user_id'").get();
    if (!triggers) {
      console.log('✅ meal_signups_v4 触发器已创建');
    }
  } catch (err) {
    console.error('❌ initMealSignupsColumns 失败:', err.message);
  }
}

// 初始化 meal_activities_v4 表缺失的列
function initMealActivitiesColumns() {
  try {
    const columns = db.prepare("PRAGMA table_info(meal_activities_v4)").all();
    const columnNames = columns.map(c => c.name);

    if (!columnNames.includes('is_temporary')) {
      db.exec("ALTER TABLE meal_activities_v4 ADD COLUMN is_temporary INTEGER DEFAULT 0");
      console.log('✅ meal_activities_v4 表新增 is_temporary 字段');
    }
    if (!columnNames.includes('guest_lunch_enabled')) {
      db.exec("ALTER TABLE meal_activities_v4 ADD COLUMN guest_lunch_enabled INTEGER DEFAULT 0");
      console.log('✅ meal_activities_v4 表新增 guest_lunch_enabled 字段');
    }
    if (!columnNames.includes('guest_lunch_start')) {
      db.exec("ALTER TABLE meal_activities_v4 ADD COLUMN guest_lunch_start TEXT DEFAULT '09:00'");
      console.log('✅ meal_activities_v4 表新增 guest_lunch_start 字段');
    }
    if (!columnNames.includes('guest_lunch_end')) {
      db.exec("ALTER TABLE meal_activities_v4 ADD COLUMN guest_lunch_end TEXT DEFAULT '10:30'");
      console.log('✅ meal_activities_v4 表新增 guest_lunch_end 字段');
    }
    if (!columnNames.includes('guest_dinner_enabled')) {
      db.exec("ALTER TABLE meal_activities_v4 ADD COLUMN guest_dinner_enabled INTEGER DEFAULT 0");
      console.log('✅ meal_activities_v4 表新增 guest_dinner_enabled 字段');
    }
    if (!columnNames.includes('guest_dinner_start')) {
      db.exec("ALTER TABLE meal_activities_v4 ADD COLUMN guest_dinner_start TEXT DEFAULT '14:00'");
      console.log('✅ meal_activities_v4 表新增 guest_dinner_start 字段');
    }
    if (!columnNames.includes('guest_dinner_end')) {
      db.exec("ALTER TABLE meal_activities_v4 ADD COLUMN guest_dinner_end TEXT DEFAULT '15:30'");
      console.log('✅ meal_activities_v4 表新增 guest_dinner_end 字段');
    }
  } catch (err) {
    console.error('❌ initMealActivitiesColumns 失败:', err.message);
  }
}

// 初始化 staff 表缺失的 name_pinyin 字段
function initStaffNamePinyin() {
  try {
    const columns = db.prepare("PRAGMA table_info(staff)").all();
    const columnNames = columns.map(c => c.name);

    if (!columnNames.includes('name_pinyin')) {
      db.exec("ALTER TABLE staff ADD COLUMN name_pinyin TEXT");
      console.log('✅ staff 表新增 name_pinyin 字段');

      // 为现有员工计算拼音首字母
      const staffList = db.prepare('SELECT id, name FROM staff WHERE name IS NOT NULL AND name != ""').all();
      const updateStmt = db.prepare('UPDATE staff SET name_pinyin = ? WHERE id = ?');
      const pinyinMap = getPinyinMap();

      staffList.forEach(staff => {
        const pinyin = getNamePinyin(staff.name, pinyinMap);
        updateStmt.run(pinyin, staff.id);
      });
      console.log(`✅ 已为 ${staffList.length} 名员工计算姓名拼音`);
    }
  } catch (err) {
    console.error('❌ initStaffNamePinyin 失败:', err.message);
  }
}

// 姓名转拼音首字母
function getNamePinyin(name, pinyinMap) {
  if (!name) return '';
  let result = '';
  for (const char of name) {
    const p = pinyinMap[char];
    if (p) result += p.charAt(0);
    else result += char.toLowerCase();
  }
  return result;
}

// 拼音映射表
function getPinyinMap() {
  return {
    '啊':'a','阿':'a','哎':'ai','爱':'ai','安':'an','暗':'an','昂':'ang',
    '吧':'ba','把':'ba','八':'ba','巴':'ba','爸':'ba','白':'bai','百':'bai',
    '班':'ban','半':'ban','办':'ban','帮':'bang','包':'bao','保':'bao','报':'bao',
    '北':'bei','被':'bei','本':'ben','比':'bi','笔':'bi','边':'bian','变':'bian',
    '别':'bie','宾':'bin','冰':'bing','兵':'bing','丙':'bing','并':'bing',
    '拨':'bo','波':'bo','博':'bo','不':'bu','步':'bu','部':'bu',
    '擦':'ca','猜':'cai','才':'cai','材':'cai','菜':'cai','参':'can','餐':'can',
    '残':'can','产':'chan','常':'chang','场':'chang','唱':'chang','厂':'chang',
    '超':'chao','朝':'chao','车':'che','陈':'chen','成':'cheng','城':'cheng',
    '吃':'chi','持':'chi','池':'chi','充':'chong','冲':'chong','出':'chu',
    '除':'chu','楚':'chu','处':'chu','传':'chuan','创':'chuang','春':'chun',
    '词':'ci','此':'ci','次':'ci','从':'cong','勿':'cong','凑':'cou',
    '粗':'cu','促':'cu','村':'cun','存':'cun','寸':'cun','错':'cuo',
    '达':'da','大':'da','带':'dai','代':'dai','待':'dai','单':'dan','但':'dan',
    '蛋':'dan','当':'dang','党':'dang','道':'dao','到':'dao','得':'de',
    '的':'de','等':'deng','低':'di','底':'di','地':'di','弟':'di','第':'di',
    '点':'dian','电':'dian','店':'dian','定':'ding','丢':'diu','东':'dong',
    '冬':'dong','懂':'dong','动':'dong','冻':'dong','都':'dou','斗':'dou',
    '读':'du','独':'du','度':'du','端':'duan','短':'duan','段':'duan','断':'duan',
    '对':'dui','队':'dui','多':'duo','夺':'duo','朵':'duo','躲':'duo',
    '额':'e','恶':'e','饿':'e','儿':'er','耳':'er','二':'er',
    '发':'fa','翻':'fan','凡':'fan','反':'fan','返':'fan','范':'fan',
    '方':'fang','房':'fang','防':'fang','非':'fei','飞':'fei','肥':'fei','费':'fei',
    '分':'fen','份':'fen','纷':'fen','粉':'fen','风':'feng','封':'feng','锋':'feng',
    '冯':'feng','奉':'feng','否':'fou','夫':'fu','服':'fu','福':'fu','付':'fu',
    '父':'fu','复':'fu','负':'fu','附':'fu','妇':'fu','高':'gao','告':'gao',
    '歌':'ge','个':'ge','给':'gei','跟':'gen','根':'gen','工':'gong','公':'gong',
    '共':'gong','功':'gong','供':'gong','狗':'gou','够':'gou','古':'gu','故':'gu',
    '顾':'gu','瓜':'gua','挂':'gua','关':'guan','观':'guan','官':'guan','管':'guan',
    '光':'guang','广':'guang','贵':'gui','桂':'gui','滚':'gun','国':'guo','果':'guo',
    '过':'guo','还':'hai','孩':'hai','海':'hai','害':'hai','汉':'han','号':'hao',
    '好':'hao','喝':'he','何':'he','合':'he','河':'he','黑':'hei','很':'hen',
    '红':'hong','后':'hou','候':'hou','厚':'hou','呼':'hu','忽':'hu','湖':'hu',
    '虎':'hu','护':'hu','互':'hu','户':'hu','花':'hua','华':'hua','化':'hua',
    '划':'hua','画':'hua','话':'hua','坏':'huai','欢':'huan','环':'huan',
    '换':'huan','黄':'huang','慌':'huang','皇':'huang','回':'hui','毁':'hui','汇':'hui',
    '会':'hui','绘':'hui','婚':'hun','混':'hun','活':'huo','火':'huo','或':'huo',
    '货':'huo','获':'huo','祸':'huo','机':'ji','鸡':'ji','积':'ji','基':'ji',
    '级':'ji','极':'ji','及':'ji','季':'ji','继':'ji','纪':'ji','技':'ji',
    '济':'ji','既':'ji','忌':'ji','加':'jia','夹':'jia','家':'jia','价':'jia',
    '架':'jia','假':'jia','嫁':'jia','尖':'jian','间':'jian','肩':'jian','艰':'jian',
    '监':'jian','减':'jian','检':'jian','简':'jian','见':'jian','建':'jian','剑':'jian',
    '健':'jian','舰':'jian','渐':'jian','江':'jiang','姜':'jiang','将':'jiang',
    '讲':'jiang','奖':'jiang','匠':'jiang','降':'jiang','交':'jiao','郊':'jiao',
    '胶':'jiao','教':'jiao','阶':'jie','街':'jie','节':'jie','劫':'jie','洁':'jie',
    '结':'jie','姐':'jie','解':'jie','界':'jie','借':'jie','金':'jin','今':'jin',
    '仅':'jin','紧':'jin','锦':'jin','进':'jin','近':'jin','劲':'jin','晋':'jin',
    '浸':'jin','京':'jing','经':'jing','精':'jing','晶':'jing','井':'jing','静':'jing',
    '境':'jing','镜':'jing','纠':'jiu','究':'jiu','酒':'jiu','九':'jiu','久':'jiu',
    '旧':'jiu','救':'jiu','就':'jiu','举':'ju','矩':'ju','句':'ju','巨':'ju',
    '拒':'ju','具':'ju','剧':'ju','聚':'ju','卷':'juan','决':'jue','角':'jue',
    '觉':'jue','绝':'jue','均':'jun','军':'jun','君':'jun','卡':'ka','开':'kai',
    '看':'kan','康':'kang','考':'kao','靠':'kao','科':'ke','可':'ke','课':'ke',
    '克':'ke','客':'ke','空':'kong','恐':'kong','孔':'kong','控':'kong','口':'kou',
    '扣':'kou','哭':'ku','苦':'ku','库':'ku','酷':'ku','夸':'kua','跨':'kua',
    '快':'kuai','块':'kuai','宽':'kuan','况':'kuang','矿':'kuang','亏':'kui',
    '愧':'kui','昆':'kun','困':'kun','扩':'kuo','拉':'la','落':'la','腊':'la',
    '来':'lai','赖':'lai','蓝':'lan','兰':'lan','拦':'lan','栏':'lan','懒':'lan',
    '烂':'lan','狼':'lang','朗':'lang','浪':'lang','老':'lao','乐':'le','雷':'lei',
    '累':'lei','泪':'lei','冷':'leng','离':'li','里':'li','理':'li','力':'li',
    '历':'li','立':'li','利':'li','例':'li','李':'li','连':'lian','联':'lian',
    '廉':'lian','恋':'lian','练':'lian','粮':'liang','两':'liang','亮':'liang',
    '量':'liang','辽':'liao','了':'liao','料':'liao','列':'lie','林':'lin','临':'lin',
    '淋':'lin','灵':'ling','零':'ling','领':'ling','另':'ling','留':'liu','流':'liu',
    '刘':'liu','六':'liu','龙':'long','拢':'long','笼':'long','隆':'long','楼':'lou',
    '漏':'lou','露':'lou','路':'lu','旅':'lv','率':'lv','绿':'lv','滤':'lv',
    '律':'lv','虑':'lv','卵':'luan','乱':'luan','略':'lue','罗':'luo','洛':'luo',
    '马':'ma','吗':'ma','妈':'ma','麻':'ma','码':'ma','买':'mai',
    '卖':'mai','满':'man','慢':'man','忙':'mang','猫':'mao','毛':'mao','矛':'mao',
    '冒':'mao','贸':'mao','帽':'mao','么':'me','没':'mei','每':'mei','美':'mei',
    '妹':'mei','门':'men','们':'men','梦':'meng','迷':'mi','谜':'mi','米':'mi',
    '面':'mian','苗':'miao','秒':'miao','民':'min','敏':'min','名':'ming','明':'ming',
    '命':'ming','摸':'mo','模':'mo','末':'mo','墨':'mo','默':'mo',
    '某':'mou','母':'mu','木':'mu','目':'mu','墓':'mu','幕':'mu','拿':'na',
    '那':'na','纳':'na','娜':'na','男':'nan','南':'nan','难':'nan','脑':'nao',
    '闹':'nao','呢':'ne','内':'nei','嫩':'nen','能':'neng','你':'ni','拟':'ni',
    '逆':'ni','年':'nian','念':'nian','娘':'niang','鸟':'niao','您':'nin','宁':'ning',
    '牛':'niu','扭':'niu','农':'nong','弄':'nong','奴':'nu','努':'nu','女':'nv',
    '暖':'nuan','虐':'nue','挪':'nuo','诺':'nuo','欧':'ou','偶':'ou','怕':'pa',
    '拍':'pai','排':'pai','派':'pai','潘':'pan','盘':'pan','判':'pan','叛':'pan',
    '庞':'pang','旁':'pang','跑':'pao','泡':'pao','朋':'peng','棚':'peng','蓬':'peng',
    '皮':'pi','偏':'pian','片':'pian','票':'piao','飘':'piao','贫':'pin','品':'pin',
    '平':'ping','评':'ping','凭':'ping','屏':'ping','破':'po','迫':'po','魄':'po',
    '扑':'pu','铺':'pu','葡':'pu','普':'pu','七':'qi','期':'qi','其':'qi','奇':'qi',
    '骑':'qi','起':'qi','气':'qi','弃':'qi','汽':'qi','契':'qi','器':'qi','千':'qian',
    '迁':'qian','签':'qian','前':'qian','钱':'qian','潜':'qian','浅':'qian','欠':'qian',
    '强':'qiang','墙':'qiang','抢':'qiang','悄':'qiao','桥':'qiao','巧':'qiao','俏':'qiao',
    '切':'qie','茄':'qie','且':'qie','窃':'qie','亲':'qin','秦':'qin','琴':'qin',
    '青':'qing','轻':'qing','清':'qing','情':'qing','请':'qing','庆':'qing','丘':'qiu',
    '秋':'qiu','求':'qiu','球':'qiu','区':'qu','曲':'qu','取':'qu',
    '去':'qu','趣':'qu','全':'quan','权':'quan','泉':'quan','拳':'quan','劝':'quan',
    '缺':'que','却':'que','雀':'que','确':'que','群':'qun','然':'ran','燃':'ran',
    '染':'ran','绕':'rao','热':'re','人':'ren','认':'ren','日':'ri',
    '荣':'rong','容':'rong','绒':'rong','如':'ru','乳':'ru','入':'ru','软':'ruan',
    '锐':'rui','瑞':'rui','润':'run','若':'ruo','弱':'ruo','撒':'sa','萨':'sa',
    '三':'san','散':'san','桑':'sang','嗓':'sang','丧':'sang','扫':'sao','色':'se',
    '森':'sen','僧':'seng','沙':'sha','纱':'sha','傻':'sha','啥':'sha','山':'shan',
    '删':'shan','扇':'shan','闪':'shan','善':'shan','伤':'shang','商':'shang','赏':'shang',
    '上':'shang','尚':'shang','梢':'shao','烧':'shao','少':'shao','绍':'shao','舌':'she',
    '舍':'she','设':'she','社':'she','射':'she','深':'shen','神':'shen',
    '审':'shen','肾':'shen','甚':'shen','升':'sheng','生':'sheng','声':'sheng','胜':'sheng',
    '省':'sheng','师':'shi','失':'shi','施':'shi','湿':'shi','十':'shi','石':'shi',
    '时':'shi','实':'shi','食':'shi','史':'shi','使':'shi','始':'shi','士':'shi',
    '世':'shi','市':'shi','示':'shi','式':'shi','试':'shi','似':'shi','事':'shi',
    '室':'shi','视':'shi','收':'shou','手':'shou','守':'shou','首':'shou','受':'shou',
    '授':'shou','寿':'shou','兽':'shou','售':'shou','书':'shu','术':'shu','树':'shu',
    '竖':'shu','数':'shu','双':'shuang','霜':'shuang','爽':'shuang','水':'shui',
    '睡':'shui','税':'shui','顺':'shun','瞬':'shun','思':'si','死':'si','四':'si',
    '似':'si','饲':'si','松':'song','耸':'song','送':'song','宋':'song','颂':'song',
    '搜':'sou','苏':'su','诉':'su','速':'su','素':'su','塑':'su','酸':'suan',
    '算':'suan','虽':'sui','随':'sui','岁':'sui','碎':'sui','孙':'sun','损':'sun',
    '所':'suo','索':'suo','锁':'suo','他':'ta','她':'ta','它':'ta','塔':'ta',
    '踏':'ta','台':'tai','太':'tai','态':'tai','抬':'tai','摊':'tan',
    '贪':'tan','坛':'tan','坦':'tan','叹':'tan','探':'tan','汤':'tang','堂':'tang',
    '塘':'tang','糖':'tang','躺':'tang','烫':'tang','掏':'tao','逃':'tao','桃':'tao',
    '淘':'tao','讨':'tao','套':'tao','特':'te','疼':'teng','腾':'teng','踢':'ti',
    '提':'ti','题':'ti','体':'ti','替':'ti','天':'tian','田':'tian','甜':'tian',
    '填':'tian','挑':'tiao','条':'tiao','跳':'tiao','贴':'tie','铁':'tie','厅':'ting',
    '听':'ting','停':'ting','庭':'ting','挺':'ting','通':'tong','同':'tong','桐':'tong',
    '铜':'tong','童':'tong','统':'tong','痛':'tong','偷':'tou','头':'tou','投':'tou',
    '透':'tou','突':'tu','图':'tu','徒':'tu','土':'tu','吐':'tu','兔':'tu',
    '团':'tuan','推':'tui','腿':'tui','退':'tui','托':'tuo','拖':'tuo','脱':'tuo',
    '娃':'wa','挖':'wa','瓦':'wa','歪':'wai','外':'wai','弯':'wan','完':'wan',
    '玩':'wan','晚':'wan','万':'wan','汪':'wang','王':'wang','往':'wang','网':'wang',
    '望':'wang','忘':'wang','危':'wei','威':'wei','微':'wei','为':'wei','韦':'wei',
    '围':'wei','违':'wei','唯':'wei','维':'wei','伟':'wei','伪':'wei','尾':'wei',
    '未':'wei','位':'wei','味':'wei','胃':'wei','卫':'wei','温':'wen','文':'wen',
    '纹':'wen','闻':'wen','问':'wen','翁':'weng','我':'wo','沃':'wo','卧':'wo',
    '握':'wo','乌':'wu','污':'wu','屋':'wu','无':'wu','五':'wu','午':'wu',
    '舞':'wu','伍':'wu','武':'wu','务':'wu','物':'wu','误':'wu','西':'xi',
    '希':'xi','息':'xi','惜':'xi','稀':'xi','溪':'xi','熄':'xi','锡':'xi',
    '习':'xi','席':'xi','袭':'xi','洗':'xi','喜':'xi',
    '系':'xi','戏':'xi','细':'xi','瞎':'xia','下':'xia','吓':'xia','夏':'xia',
    '厦':'xia','仙':'xian','先':'xian','纤':'xian','鲜':'xian','闲':'xian','弦':'xian',
    '贤':'xian','咸':'xian','显':'xian','险':'xian','县':'xian','现':'xian','线':'xian',
    '限':'xian','陷':'xian','献':'xian','腺':'xian','相':'xiang','香':'xiang','箱':'xiang',
    '想':'xiang','向':'xiang','象':'xiang','像':'xiang','小':'xiao','晓':'xiao','孝':'xiao',
    '校':'xiao','笑':'xiao','效':'xiao','些':'xie','协':'xie','斜':'xie','写':'xie',
    '血':'xie','谢':'xie','解':'xie','新':'xin','心':'xin','辛':'xin','欣':'xin',
    '锌':'xin','信':'xin','兴':'xing','星':'xing','猩':'xing','惊':'xing','刑':'xing',
    '行':'xing','形':'xing','型':'xing','醒':'xing','杏':'xing','姓':'xing','凶':'xiong',
    '兄':'xiong','胸':'xiong','熊':'xiong','休':'xiu','修':'xiu','羞':'xiu','朽':'xiu',
    '秀':'xiu','袖':'xiu','绣':'xiu','需':'xu','虚':'xu','须':'xu','徐':'xu',
    '许':'xu','续':'xu','蓄':'xu','雪':'xue','循':'xun','寻':'xun',
    '巡':'xun','训':'xun','讯':'xun','迅':'xun','压':'ya','呀':'ya','押':'ya',
    '鸭':'ya','牙':'ya','芽':'ya','雅':'ya','亚':'ya','烟':'yan',
    '咽':'yan','淹':'yan','盐':'yan','严':'yan','岩':'yan','研':'yan','炎':'yan','沿':'yan','燕':'yan','艳':'yan','演':'yan','彦':'yan',
    '央':'yang','殃':'yang','秧':'yang','扬':'yang','羊':'yang','阳':'yang','氧':'yang','仰':'yang','养':'yang','样':'yang','姚':'yao','尧':'yao',
    '腰':'yao','邀':'yao','摇':'yao','遥':'yao','咬':'yao','药':'yao','要':'yao','耀':'yao','爷':'ye',
    '也':'ye','夜':'ye','液':'ye','业':'ye','叶':'ye','页':'ye','医':'yi','依':'yi','衣':'yi','宜':'yi','姨':'yi','移':'yi',
    '已':'yi','乙':'yi','以':'yi','艺':'yi','议':'yi','易':'yi','益':'yi','意':'yi','溢':'yi','翼':'yi','因':'yin','阴':'yin','音':'yin',
    '银':'yin','引':'yin','饮':'yin','印':'yin','英':'ying','应':'ying','樱':'ying','鹰':'ying','迎':'ying','盈':'ying','营':'ying','影':'ying','映':'ying','硬':'ying','颖':'ying',
    '哟':'yo','用':'yong','优':'you','忧':'you','尤':'you','由':'you','邮':'you',
    '犹':'you','油':'you','游':'you','友':'you','有':'you','又':'you','右':'you',
    '幼':'you','鱼':'yu','予':'yu','与':'yu','雨':'yu','玉':'yu','育':'yu',
    '狱':'yu','浴':'yu','预':'yu','域':'yu','欲':'yu','御':'yu','遇':'yu','裕':'yu','誉':'yu','寓':'yu','豫':'yu','煜':'yu','昱':'yu','渊':'yuan','元':'yuan','园':'yuan',
    '袁':'yuan','援':'yuan','缘':'yuan','远':'yuan','怨':'yuan','院':'yuan','愿':'yuan',
    '月':'yue','乐':'yue','钥':'yue','阅':'yue','跃':'yue','越':'yue','云':'yun',
    '匀':'yun','孕':'yun','运':'yun','晕':'yun','韵':'yun','杂':'za','砸':'za',
    '灾':'zai','栽':'zai','宰':'zai','在':'zai','再':'zai','咱':'zan','攒':'zan',
    '暂':'zan','赞':'zan','脏':'zang','葬':'zang','遭':'zao','糟':'zao','早':'zao',
    '枣':'zao','蚤':'zao','澡':'zao','皂':'zao','造':'zao','噪':'zao','燥':'zao',
    '躁':'zao','则':'ze','择':'ze','泽':'ze','责':'ze','贼':'zei','怎':'zen',
    '增':'zeng','赠':'zeng','扎':'zha','闸':'zha','眨':'zha','栅':'zha','炸':'zha',
    '摘':'zhai','宅':'zhai','窄':'zhai','债':'zhai','寨':'zhai','占':'zhan','站':'zhan',
    '战':'zhan','绽':'zhan','张':'zhang','章':'zhang','掌':'zhang','丈':'zhang',
    '账':'zhang','涨':'zhang','障':'zhang','招':'zhao','昭':'zhao','找':'zhao','召':'zhao',
    '照':'zhao','罩':'zhao','兆':'zhao','赵':'zhao','者':'zhe',
    '这':'zhe','着':'zhe','浙':'zhe','真':'zhen','针':'zhen','振':'zhen','震':'zhen',
    '镇':'zhen','阵':'zhen','争':'zheng','征':'zheng','挣':'zheng','睁':'zheng',
    '正':'zheng','政':'zheng','症':'zheng','证':'zheng','郑':'zheng',
    '只':'zhi','之':'zhi','织':'zhi','汁':'zhi','知':'zhi','指':'zhi','止':'zhi',
    '址':'zhi','纸':'zhi','至':'zhi','志':'zhi','治':'zhi','质':'zhi',
    '致':'zhi','置':'zhi','中':'zhong','忠':'zhong','钟':'zhong','终':'zhong','种':'zhong',
    '肿':'zhong','重':'zhong','仲':'zhong','众':'zhong','舟':'zhou','州':'zhou','周':'zhou',
    '洲':'zhou','轴':'zhou','肘':'zhou','帚':'zhou','宙':'zhou',
    '昼':'zhou','皱':'zhou','骤':'zhou','朱':'zhu','株':'zhu','珠':'zhu','猪':'zhu',
    '竹':'zhu','逐':'zhu','烛':'zhu','主':'zhu','柱':'zhu','助':'zhu','住':'zhu',
    '注':'zhu','祝':'zhu','著':'zhu','驻':'zhu','抓':'zhua','爪':'zhua','拽':'zhuai',
    '专':'zhuan','砖':'zhuan','转':'zhuan','赚':'zhuan','撰':'zhuan','庄':'zhuang',
    '桩':'zhuang','装':'zhuang','壮':'zhuang','状':'zhuang','撞':'zhuang','追':'zhui',
    '坠':'zhui','缀':'zhui','准':'zhun','捉':'zhuo','桌':'zhuo','灼':'zhuo','卓':'zhuo',
    '浊':'zhuo','酌':'zhuo','啄':'zhuo','姿':'zi','资':'zi','滋':'zi','子':'zi',
    '自':'zi','字':'zi','综':'zong','总':'zong','纵':'zong','走':'zou','奏':'zou',
    '揍':'zou','租':'zu','足':'zu','卒':'zu','族':'zu','阻':'zu','组':'zu',
    '祖':'zu','钻':'zuan','攥':'zuan','嘴':'zui','最':'zui','罪':'zui','醉':'zui',
    '尊':'zun','遵':'zun','昨':'zuo','左':'zuo','佐':'zuo','作':'zuo','坐':'zuo',
    '座':'zuo','做':'zuo',
    // 补充数据库中的姓氏
    '邬':'wu','杰':'jie','巧':'qiao','红':'hong','琴':'qin','璐':'lu','菲':'fei','婉':'wan','晨':'chen','葛':'ge',
    '丰':'feng','佳':'jia','怡':'yi','冉':'ran','斌':'bin','玻':'bo','谈':'tan','法':'fa','奚':'xi','胡':'hu',
    '玲':'ling','莲':'lian','芬':'fen','杨':'yang','鹏':'peng','洁':'jie','戴':'dai','宣':'xuan','俞':'yu',
    '昌':'chang','呈':'cheng','蒋':'jiang','建':'jian','吴':'wu','彬':'bin','诚':'cheng','学':'xue','魏':'wei','洪':'hong',
    '晶':'jing','梦':'meng','琳':'lin','智':'zhi','尹':'yin','适':'shi','灶':'zao','岳':'yue','峰':'feng','柳':'liu',
    '桢':'zhen','琨':'kun','宇':'yu','莫':'mo','铭':'ming','骏':'jun','彪':'biao','财':'cai','翔':'xiang','哲':'zhe',
    '豪':'hao','鸳':'yuan','侃':'kan','凯':'kai','俊':'jun','燕':'yan','慧':'hui','格':'ge','莉':'li','丽':'li','余':'yu',
    '永':'yong','坚':'jian','吕':'lv','雪':'xue','齐':'qi','铎':'duo','储':'chu','津':'jin','涛':'tao','谭':'tan',
    '辉':'hui','曹':'cao','德':'de','祥':'xiang','蔡':'cai','槐':'huai','刚':'gang','港':'gang','邱':'qiu','杜':'du',
    '纯':'chun','彦':'yan','柯':'ke','臻':'zhen','曾':'zeng','董':'dong','龚':'gong','傅':'fu','邵':'shao','媛':'yuan',
    '勇':'yong','宏':'hong','展':'zhan','邢':'xing','坤':'kun','鑫':'xin','芳':'fang','赫':'he','梁':'liang','玄':'xuan',
    '赛':'sai','雷':'lei','韩':'han','璟':'jing','梅':'mei','龙':'long','爱':'ai'
  };
}

// 初始化投票相关表和字段
function initVotingTables() {
  try {
    // 检查 votings 表是否有 anonymous_token 字段
    const votingsColumns = db.prepare("PRAGMA table_info(votings)").all();
    const hasAnonymousToken = votingsColumns.some(col => col.name === 'anonymous_token');
    if (!hasAnonymousToken) {
      // SQLite不支持ALTER TABLE ADD COLUMN添加UNIQUE列，需要重建表
      // 这里先用不带UNIQUE的方式添加列，然后单独创建索引
      db.exec("ALTER TABLE votings ADD COLUMN anonymous_token TEXT");
      console.log('✅ votings 表新增 anonymous_token 字段');
      // 创建唯一索引
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_votings_anonymous_token ON votings(anonymous_token)");
      console.log('✅ anonymous_token 唯一索引已创建');
    }

    // 检查 votings 表是否有 allowed_staff_ids 字段
    const votingsCols = db.prepare("PRAGMA table_info(votings)").all();
    const hasAllowedStaffIds = votingsCols.some(col => col.name === 'allowed_staff_ids');
    if (!hasAllowedStaffIds) {
      db.exec("ALTER TABLE votings ADD COLUMN allowed_staff_ids TEXT");
      console.log('✅ votings 表新增 allowed_staff_ids 字段');
    }

    // 检查 voting_records 表结构，移除阻止匿名投票的UNIQUE约束
    const recordsInfo = db.prepare("PRAGMA index_list(voting_records)").all();
    const hasUniqueConstraint = recordsInfo.some(idx => idx.unique === 1);
    if (hasUniqueConstraint) {
      // 重建 voting_records 表，移除 UNIQUE 约束
      // 先备份数据
      const records = db.prepare("SELECT * FROM voting_records").all();
      // 删除旧表
      db.exec("DROP TABLE voting_records");
      // 用不带 UNIQUE 约束的方式重建表
      db.exec(`
        CREATE TABLE IF NOT EXISTS voting_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          voting_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          option_id INTEGER,
          device_token TEXT,
          employee_id TEXT,
          employee_name TEXT,
          voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (voting_id) REFERENCES votings(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      // 恢复数据（注意：旧数据的 option_ids 需要拆分，这里简化处理只保留第一条记录的 option_id）
      const insertStmt = db.prepare(`
        INSERT INTO voting_records (id, voting_id, user_id, option_id, device_token, employee_id, employee_name, voted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      records.forEach(r => {
        // 旧数据 option_ids 是逗号分隔，取第一个作为 option_id
        const firstOptId = r.option_ids ? parseInt(r.option_ids.split(',')[0]) : null;
        insertStmt.run(r.id, r.voting_id, r.user_id, firstOptId, r.device_token, r.employee_id, r.employee_name, r.voted_at);
      });
      // 重建索引
      db.exec("CREATE INDEX IF NOT EXISTS idx_voting_records_voting_id ON voting_records(voting_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_voting_records_user_id ON voting_records(user_id)");
      console.log('✅ voting_records 表已重建，移除了阻止匿名投票的 UNIQUE 约束');
    }

    // 检查 voting_records 表是否有新字段
    const recordsColumns = db.prepare("PRAGMA table_info(voting_records)").all();
    if (!recordsColumns.some(col => col.name === 'device_token')) {
      db.exec("ALTER TABLE voting_records ADD COLUMN device_token TEXT");
      console.log('✅ voting_records 表新增 device_token 字段');
    }
    if (!recordsColumns.some(col => col.name === 'employee_id')) {
      db.exec("ALTER TABLE voting_records ADD COLUMN employee_id TEXT");
      console.log('✅ voting_records 表新增 employee_id 字段');
    }
    if (!recordsColumns.some(col => col.name === 'employee_name')) {
      db.exec("ALTER TABLE voting_records ADD COLUMN employee_name TEXT");
      console.log('✅ voting_records 表新增 employee_name 字段');
    }

    // 创建匿名投票设备记录表
    db.exec(`
      CREATE TABLE IF NOT EXISTS voting_device_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        voting_id INTEGER NOT NULL,
        device_token TEXT NOT NULL,
        employee_id TEXT,
        employee_name TEXT,
        voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(voting_id, device_token)
      )
    `);
    console.log('✅ voting_device_tokens 表已创建/存在');
  } catch (err) {
    console.error('❌ 初始化投票表失败:', err.message);
  }
}

// 初始化权限操作日志表
function initPermissionLogsTable() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS permission_action_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        tab TEXT,
        action TEXT,
        status TEXT DEFAULT 'success',
        created_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `);
    // 检查是否需要添加 status 列
    const columns = db.prepare("PRAGMA table_info(permission_action_logs)").all();
    const columnNames = columns.map(c => c.name);
    if (!columnNames.includes('status')) {
      db.exec("ALTER TABLE permission_action_logs ADD COLUMN status TEXT DEFAULT 'success'");
      console.log('✅ permission_action_logs 表新增 status 字段');
    }
    console.log('✅ permission_action_logs 表已创建/存在');
  } catch (err) {
    console.error('❌ 初始化权限日志表失败:', err.message);
  }
}

function initFeedbackTable() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id INTEGER,
        staff_name TEXT,
        employee_id TEXT,
        category TEXT NOT NULL DEFAULT 'other',
        description TEXT NOT NULL,
        screenshots TEXT,
        page_url TEXT,
        user_agent TEXT,
        status TEXT DEFAULT 'pending',
        admin_reply TEXT,
        resolved_at DATETIME,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `);
    console.log('✅ feedback 表已创建/存在');
  } catch (err) {
    console.error('❌ 初始化反馈表失败:', err.message);
  }
}

// 初始化学生名册表
function initStudentRoster() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS student_roster (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        employee_id TEXT UNIQUE,
        school TEXT,
        department TEXT,
        sub_department TEXT,
        position TEXT,
        training_date TEXT,
        dinggang_date TEXT,
        phone TEXT,
        id_card TEXT,
        home_address TEXT,
        education TEXT,
        major TEXT,
        emergency_contact TEXT,
        emergency_relation TEXT,
        emergency_phone TEXT,
        source_employee_id TEXT,
        synced_at DATETIME DEFAULT (datetime('now', 'localtime')),
        created_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `);
    console.log('✅ student_roster 表已创建/存在');
  } catch (err) {
    console.error('❌ 初始化学生名册表失败:', err.message);
  }
}

// 初始化6S记录表缺失的字段和区域分级表
function initSixSRecords() {
  try {
    // 1. 创建区域分级表
    db.exec(`
      CREATE TABLE IF NOT EXISTS s6_areas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parent_id INTEGER DEFAULT 0,
        area_code INTEGER,
        floor TEXT,
        responsible TEXT,
        responsible_employee_id TEXT,
        py TEXT,
        py_person TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `);
    console.log('✅ s6_areas 区域分级表已创建/存在');

    const areaColumns = db.prepare("PRAGMA table_info(s6_areas)").all();
    const areaColumnNames = areaColumns.map(c => c.name);
    if (!areaColumnNames.includes('area_code')) {
      db.exec("ALTER TABLE s6_areas ADD COLUMN area_code INTEGER");
      console.log('✅ s6_areas 表新增 area_code 字段');
    }
    if (!areaColumnNames.includes('floor')) {
      db.exec("ALTER TABLE s6_areas ADD COLUMN floor TEXT");
      console.log('✅ s6_areas 表新增 floor 字段');
    }
    if (!areaColumnNames.includes('responsible')) {
      db.exec("ALTER TABLE s6_areas ADD COLUMN responsible TEXT");
      console.log('✅ s6_areas 表新增 responsible 字段');
    }
    if (!areaColumnNames.includes('responsible_employee_id')) {
      db.exec("ALTER TABLE s6_areas ADD COLUMN responsible_employee_id TEXT");
      console.log('✅ s6_areas 表新增 responsible_employee_id 字段');
    }
    if (!areaColumnNames.includes('py')) {
      db.exec("ALTER TABLE s6_areas ADD COLUMN py TEXT");
      console.log('✅ s6_areas 表新增 py 字段');
    }
    if (!areaColumnNames.includes('py_person')) {
      db.exec("ALTER TABLE s6_areas ADD COLUMN py_person TEXT");
      console.log('✅ s6_areas 表新增 py_person 字段');
    }

    // 2. 创建区域与责任人关联表
    db.exec(`
      CREATE TABLE IF NOT EXISTS s6_area_responsibles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        area_id INTEGER NOT NULL,
        staff_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        UNIQUE(area_id, staff_id)
      )
    `);
    console.log('✅ s6_area_responsibles 区域责任人关联表已创建/存在');

    // 3. 检查 six_s_records 表字段
    const columns = db.prepare("PRAGMA table_info(six_s_records)").all();
    const columnNames = columns.map(c => c.name);

    // 添加 before_image_time 字段
    if (!columnNames.includes('before_image_time')) {
      db.exec("ALTER TABLE six_s_records ADD COLUMN before_image_time DATETIME");
      console.log('✅ six_s_records 表新增 before_image_time 字段');
    }

    if (!columnNames.includes('before_images')) {
      db.exec("ALTER TABLE six_s_records ADD COLUMN before_images TEXT");
      console.log('✅ six_s_records 表新增 before_images 字段');
    }

    // 添加 after_image_time 字段
    if (!columnNames.includes('after_image_time')) {
      db.exec("ALTER TABLE six_s_records ADD COLUMN after_image_time DATETIME");
      console.log('✅ six_s_records 表新增 after_image_time 字段');
    }

    if (!columnNames.includes('after_images')) {
      db.exec("ALTER TABLE six_s_records ADD COLUMN after_images TEXT");
      console.log('✅ six_s_records 表新增 after_images 字段');
    }

    // 添加 created_by_username 字段（创建人登录账号）
    if (!columnNames.includes('created_by_username')) {
      db.exec("ALTER TABLE six_s_records ADD COLUMN created_by_username TEXT");
      console.log('✅ six_s_records 表新增 created_by_username 字段');
    }

    // 添加 default_deadline_days 字段（默认截止天数）
    if (!columnNames.includes('default_deadline_days')) {
      db.exec("ALTER TABLE six_s_records ADD COLUMN default_deadline_days INTEGER DEFAULT 3");
      console.log('✅ six_s_records 表新增 default_deadline_days 字段');
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS s6_review_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        record_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        comment TEXT,
        operator_id INTEGER,
        operator_name TEXT,
        image TEXT,
        images TEXT,
        image_time DATETIME,
        created_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `);
    const logColumns = db.prepare("PRAGMA table_info(s6_review_logs)").all();
    const logColumnNames = logColumns.map(c => c.name);
    if (!logColumnNames.includes('image')) {
      db.exec("ALTER TABLE s6_review_logs ADD COLUMN image TEXT");
      console.log('✅ s6_review_logs 表新增 image 字段');
    }
    if (!logColumnNames.includes('images')) {
      db.exec("ALTER TABLE s6_review_logs ADD COLUMN images TEXT");
      console.log('✅ s6_review_logs 表新增 images 字段');
    }
    if (!logColumnNames.includes('image_time')) {
      db.exec("ALTER TABLE s6_review_logs ADD COLUMN image_time DATETIME");
      console.log('✅ s6_review_logs 表新增 image_time 字段');
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS s6_cloud_sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_table TEXT NOT NULL,
        target_id INTEGER NOT NULL,
        primary_field TEXT NOT NULL,
        list_field TEXT,
        local_urls TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        retry_count INTEGER DEFAULT 0,
        last_error TEXT,
        next_retry_at DATETIME DEFAULT (datetime('now', 'localtime')),
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `);
    console.log('✅ s6_cloud_sync_queue 队列表已创建/存在');

    // 初始化默认区域数据
    const areaCount = db.prepare("SELECT COUNT(*) as c FROM s6_areas").get().c;
    if (areaCount === 0) {
      const insertArea = db.prepare("INSERT INTO s6_areas (name, parent_id, sort_order) VALUES (?, ?, ?)");
      // 一级区域
      insertArea.run('生产区', 0, 1);
      insertArea.run('办公区', 0, 2);
      insertArea.run('后勤区', 0, 3);
      // 二级区域 - 生产区
      insertArea.run('生产车间', 1, 1);
      insertArea.run('仓库', 1, 2);
      insertArea.run('质检区', 1, 3);
      // 二级区域 - 办公区
      insertArea.run('办公室', 2, 1);
      insertArea.run('会议室', 2, 2);
      insertArea.run('休息室', 2, 3);
      // 二级区域 - 后勤区
      insertArea.run('卫生间', 3, 1);
      insertArea.run('食堂', 3, 2);
      insertArea.run('宿舍', 3, 3);
      console.log('✅ 默认区域数据已初始化');
    }
  } catch (err) {
    console.error('❌ initSixSRecords 失败:', err.message);
  }
}

function ensureColumn(table, name, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(column => column.name === name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    console.log(`✅ ${table} 表新增 ${name} 字段`);
  }
}

const TASK_POSITION_EXACT_LEVELS = new Map([
  ['总经理', 10],
  ['财务总监', 9],
  ['技术总工程师', 8],
  ['白班保安', 1],
  ['夜班保安', 1]
]);

const TASK_POSITION_KEYWORD_LEVELS = [
  { level: 9, keywords: ['副总经理', '总监'] },
  { level: 8, keywords: ['总工程师', '部长'] },
  { level: 7, keywords: ['科长'] },
  { level: 6, keywords: ['组长', '主管', '领班'] },
  { level: 4, keywords: ['助理工程师', '中级', '专员', '文员', '计划员', '报价专员', '采购员', '仓管员', '管理员'] },
  { level: 3, keywords: ['助理', '出纳', '单证员', '调机'] },
  { level: 2, keywords: ['师傅', '普师', '作业员', '测量员', '质检员', '抛光员', '注塑工', '电工', '驾驶员'] },
  { level: 1, keywords: ['学徒', '杂工', '保洁', '保安'] },
  { level: 5, keywords: ['高级', '工程师', '设计师', '编程', '运维', '会计'] }
];

function resolveTaskPositionLevel(positionName) {
  const position = String(positionName || '').trim();
  if (!position) return { level: 1, company_wide: 0 };
  if (TASK_POSITION_EXACT_LEVELS.has(position)) {
    const level = TASK_POSITION_EXACT_LEVELS.get(position);
    return { level, company_wide: level >= 9 ? 1 : 0 };
  }

  for (const rule of TASK_POSITION_KEYWORD_LEVELS) {
    if (rule.keywords.some(keyword => position.includes(keyword))) {
      return { level: rule.level, company_wide: rule.level >= 9 ? 1 : 0 };
    }
  }

  return { level: 1, company_wide: 0 };
}

function syncTaskPositionLevels() {
  const positions = db.prepare(`
    SELECT DISTINCT TRIM(position) AS position_name
    FROM staff
    WHERE position IS NOT NULL AND TRIM(position) <> ''
  `).all();

  if (!positions.length) return;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO task_position_levels (position_name, level, company_wide, updated_at)
    VALUES (?, ?, ?, datetime('now', 'localtime'))
  `);

  db.transaction(items => {
    items.forEach(({ position_name }) => {
      const { level, company_wide } = resolveTaskPositionLevel(position_name);
      insert.run(position_name, level, company_wide);
    });
  })(positions);

  console.log(`✅ 任务岗位级别规则已补齐: ${positions.length} 个岗位`);
}

function initNotificationCenter() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient_type TEXT NOT NULL,
        recipient_id INTEGER NOT NULL,
        category TEXT NOT NULL DEFAULT 'notice',
        module TEXT NOT NULL DEFAULT 'system',
        source_id INTEGER,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        link TEXT,
        level TEXT NOT NULL DEFAULT 'info',
        is_read INTEGER NOT NULL DEFAULT 0,
        created_by_type TEXT,
        created_by_id INTEGER,
        created_by_name TEXT,
        read_at DATETIME,
        created_at DATETIME DEFAULT (datetime('now', 'localtime'))
      );

      CREATE INDEX IF NOT EXISTS idx_notifications_recipient
      ON notifications(recipient_type, recipient_id, is_read, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_notifications_module
      ON notifications(module, source_id, created_at DESC);
    `);
    console.log('✅ 通知中心数据结构已初始化');
  } catch (err) {
    console.error('❌ initNotificationCenter 失败:', err.message);
    throw err;
  }
}

function initMiniAppIntegration() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS miniapp_user_bindings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient_type TEXT NOT NULL,
        recipient_id INTEGER NOT NULL,
        app_id TEXT NOT NULL DEFAULT '',
        openid TEXT NOT NULL,
        unionid TEXT,
        nickname TEXT,
        avatar_url TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        last_seen_at DATETIME DEFAULT (datetime('now', 'localtime')),
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
        UNIQUE(recipient_type, recipient_id, app_id)
      );

      CREATE INDEX IF NOT EXISTS idx_miniapp_bindings_openid
      ON miniapp_user_bindings(openid, status);

      CREATE TABLE IF NOT EXISTS miniapp_template_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient_type TEXT NOT NULL,
        recipient_id INTEGER NOT NULL,
        app_id TEXT NOT NULL DEFAULT '',
        template_key TEXT NOT NULL,
        template_id TEXT,
        page_path TEXT,
        scene TEXT NOT NULL DEFAULT '',
        subscribed INTEGER NOT NULL DEFAULT 1,
        updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
        last_subscribed_at DATETIME,
        UNIQUE(recipient_type, recipient_id, app_id, template_key)
      );

      CREATE INDEX IF NOT EXISTS idx_miniapp_subscriptions_lookup
      ON miniapp_template_subscriptions(recipient_type, recipient_id, app_id, subscribed);

      CREATE TABLE IF NOT EXISTS miniapp_push_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        notification_id INTEGER,
        recipient_type TEXT NOT NULL,
        recipient_id INTEGER NOT NULL,
        app_id TEXT NOT NULL DEFAULT '',
        openid TEXT NOT NULL,
        template_key TEXT NOT NULL,
        template_id TEXT,
        page_path TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        payload_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        source_module TEXT NOT NULL DEFAULT 'system',
        source_category TEXT NOT NULL DEFAULT 'notice',
        source_id INTEGER,
        error_message TEXT,
        sent_at DATETIME,
        created_at DATETIME DEFAULT (datetime('now', 'localtime'))
      );

      CREATE INDEX IF NOT EXISTS idx_miniapp_push_queue_status
      ON miniapp_push_queue(status, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_miniapp_push_queue_recipient
      ON miniapp_push_queue(recipient_type, recipient_id, created_at DESC);
    `);
    console.log('✅ 小程序混合接入数据结构已初始化');
  } catch (err) {
    console.error('❌ initMiniAppIntegration 失败:', err.message);
    throw err;
  }
}

// 初始化个人待办与团队任务工作台
function initTaskWorkbench() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at DATETIME DEFAULT (datetime('now', 'localtime'))
      );

      CREATE TABLE IF NOT EXISTS task_position_levels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_name TEXT NOT NULL UNIQUE,
        level INTEGER NOT NULL DEFAULT 1,
        company_wide INTEGER NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      );
    `);

    ensureColumn('users', 'staff_id', 'INTEGER');
    ensureColumn('tasks', 'scope', "TEXT DEFAULT 'legacy'");
    ensureColumn('tasks', 'category', "TEXT DEFAULT 'other'");
    ensureColumn('tasks', 'owner_user_id', 'INTEGER');
    ensureColumn('tasks', 'assigned_staff_id', 'INTEGER');
    ensureColumn('tasks', 'created_by_user_id', 'INTEGER');
    ensureColumn('tasks', 'due_at', 'DATETIME');
    ensureColumn('tasks', 'remind_at', 'DATETIME');
    ensureColumn('tasks', 'source_label', "TEXT DEFAULT 'manual'");
    ensureColumn('tasks', 'completed_at', 'DATETIME');
    ensureColumn('tasks', 'updated_at', "DATETIME DEFAULT (datetime('now', 'localtime'))");
    ensureColumn('tasks', 'parent_task_id', 'INTEGER');
    ensureColumn('tasks', 'task_kind', "TEXT DEFAULT 'task'");

    db.exec(`
      UPDATE tasks
      SET scope = COALESCE(NULLIF(scope, ''), 'legacy'),
          category = COALESCE(NULLIF(category, ''), CASE WHEN type IN ('exam', 'meal') THEN type ELSE 'other' END),
          created_by_user_id = COALESCE(created_by_user_id, assigned_by),
          due_at = COALESCE(due_at, due_date)
      WHERE scope IS NULL OR scope = '' OR category IS NULL OR category = ''
         OR created_by_user_id IS NULL OR due_at IS NULL;

      INSERT OR IGNORE INTO task_position_levels (position_name)
      SELECT DISTINCT TRIM(position)
      FROM staff
      WHERE position IS NOT NULL AND TRIM(position) <> '';

      UPDATE users
      SET staff_id = (
        SELECT staff.id FROM staff WHERE staff.employee_id = users.username LIMIT 1
      )
      WHERE staff_id IS NULL
        AND EXISTS (SELECT 1 FROM staff WHERE staff.employee_id = users.username);

      CREATE INDEX IF NOT EXISTS idx_tasks_scope_owner ON tasks(scope, owner_user_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_assigned_staff ON tasks(assigned_staff_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_creator ON tasks(created_by_user_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent_task ON tasks(parent_task_id);
    `);

    syncTaskPositionLevels();

    db.prepare(`
      INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)
    `).run('20260601_task_workbench');
    db.prepare(`
      INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)
    `).run('20260601_task_position_level_bootstrap');
    console.log('✅ 个人待办工作台数据结构已初始化');
  } catch (err) {
    console.error('❌ initTaskWorkbench 失败:', err.message);
    throw err;
  }
}

// 旧版本会在每次启动时重建多张表，容易破坏索引和 WAL。
// 保留迁移标记，不再对已有业务表做启动期重建。
function migrateTimestampsToLocaltime() {
  db.prepare(`
    INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)
  `).run('legacy_timestamp_rebuild_disabled');
}

// 执行初始化
try {
  initDatabase();
  // 设置 WAL 模式提高性能
  db.pragma('journal_mode = WAL');
  console.log('✅ 数据库配置完成');
} catch (err) {
  console.error('❌ 初始化失败，退出程序');
  process.exit(1);
}

module.exports = db;
