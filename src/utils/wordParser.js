// src/utils/wordParser.js
/**
 * 解析 Word 文档格式的题目
 * 支持多种格式：
 * 
 * 格式1（推荐）：
 * 1. 题目内容
 * A. 选项A
 * B. 选项B
 * 答案：A
 *
 * 格式2（带题型标记）：
 * 判断题
 * 1. 题目内容
 * A. 正确
 * B. 错误
 * 答案：A
 *
 * 格式3（选项无点号）：
 * 1. 题目内容
 * A 选项A
 * B 选项B
 * 答案：A
 */

class WordParser {
  parse(text) {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    const questions = [];
    let currentQuestion = null;
    let questionIndex = 0;
    let currentScore = 10; // 默认分值

    // 预处理：合并连续的空行
    const processedLines = [];
    let lastLine = '';

    for (const line of lines) {
      // 跳过明显的空行或分隔线
      if (line === '' || line.match(/^[=—_\-*]{10,}$/)) {
        continue;
      }
      processedLines.push(line);
    }

    for (const line of processedLines) {
      // 1. 检测题型标题（如果是，跳过）
      if (this.isQuestionTypeTitle(line)) {
        // 从章节标题中解析分值
        const scoreMatch = line.match(/每题(\d+)分|每个正确选项(\d+)分/);
        if (scoreMatch) {
          currentScore = parseInt(scoreMatch[1] || scoreMatch[2]);
        }
        continue;
      }

      // 2. 检测题目编号（如：1. 2. 3. [一二三四五六七八九十]）
      const numberMatch = this.matchQuestionNumber(line);
      if (numberMatch) {
        // 跳过标题行（如：一、单选题  二、判断题）
        if (this.isSectionTitle(numberMatch.content)) {
          // 从章节标题中解析分值
          const scoreMatch = line.match(/每题(\d+)分|每个正确选项(\d+)分/);
          if (scoreMatch) {
            currentScore = parseInt(scoreMatch[1] || scoreMatch[2]);
          }
          continue;
        }

        // 保存上一题
        if (currentQuestion && (currentQuestion.content || currentQuestion.options.length > 0)) {
          questions.push(currentQuestion);
        }

        questionIndex++;
        let questionContent = numberMatch.content;
        let questionType = 'single_choice';
        let answer = '';

        // 检测是否是判断题（内容末尾有（ ）或（√）或（×））
        const trueFalseMatch = questionContent.match(/^(.+)[（(]\s*([√×Xx]?)\s*[）)]\s*$/);
        if (trueFalseMatch) {
          questionContent = trueFalseMatch[1].trim();
          if (trueFalseMatch[2]) {
            const tf = trueFalseMatch[2].toUpperCase();
            answer = (tf === 'X') ? '×' : tf;
            questionType = 'true_false';
          } else {
            // 空括号，标记为待填判断题
            questionType = 'true_false';
          }
        }

        // 去除末尾句号后的空白
        questionContent = questionContent.replace(/\s*\。+\s*$/, '').trim();

        currentQuestion = {
          sort_order: questionIndex,
          content: questionContent,
          options: [],
          answer: answer,
          type: questionType,
          score: currentScore
        };
        continue;
      }

      // 3. 检测选项（A. 选项A 或 A 选项A 或 (A) 选项A 或 A、内容）
      const optionMatch = this.matchOption(line);
      if (optionMatch && currentQuestion) {
        currentQuestion.options.push(optionMatch.text);

        // 检查同行的其他选项（以多个空格分隔的选项，如：A、xxx     B、yyy     C、zzz）
        const remainingLine = line.substring(line.indexOf(optionMatch.text) + optionMatch.text.length).trim();
        if (remainingLine) {
          // 继续匹配同行中的其他选项
          const extraOptions = this.matchMultipleOptions(remainingLine);
          for (const opt of extraOptions) {
            currentQuestion.options.push(opt);
          }
        }
        continue;
      }

      // 4. 检测答案
      const answerMatch = this.matchAnswer(line);
      if (answerMatch && currentQuestion) {
        const answerText = answerMatch.answer;
        this.processAnswer(currentQuestion, answerText);
        continue;
      }

      // 5. 如果没有匹配到任何东西，但 currentQuestion 存在，可能是题目内容的续行
      if (currentQuestion && !currentQuestion.options.length && !currentQuestion.answer) {
        currentQuestion.content += '\n' + line;
      }
    }

    // 保存最后一题
    if (currentQuestion && (currentQuestion.content || currentQuestion.options.length > 0)) {
      questions.push(currentQuestion);
    }

    // 后处理：清理内容，推断类型
    for (const q of questions) {
      q.content = q.content.trim();
      
      // 如果选项为空且答案存在，可能是判断题
      if (q.options.length === 0 && q.answer) {
        if (['√', '×', '正确', '错误', '对', '错'].includes(q.answer)) {
          q.type = 'true_false';
        }
      }
      
      // 如果选项只有一个且是判断题，改为判断题
      if (q.options.length === 1) {
        const opt = q.options[0].toLowerCase();
        if (opt.includes('正确') || opt.includes('错误') || opt.includes('对') || opt.includes('错') ||
            opt === '√' || opt === '×') {
          q.type = 'true_false';
        }
      }

      // 判断题特殊检测：选项只有"正确"和"错误"（A/B形式），答案为字母
      if (q.options.length === 2) {
        const opts = q.options.map(o => o.toLowerCase());
        const isTrueFalseFormat = (opts.includes('正确') && opts.includes('错误')) ||
                                   (opts.includes('对') && opts.includes('错'));
        if (isTrueFalseFormat && /^[A-D]$/i.test(q.answer)) {
          q.type = 'true_false';
          // 将字母答案转换为符号
          q.answer = q.answer.toUpperCase() === 'A' ? '√' : '×';
        }
      }
    }

    return {
      questions,
      total: questions.length,
      paperTitle: '导入试卷'
    };
  }

  isQuestionTypeTitle(line) {
    // 只跳过纯标题行（如只有"判断题"或"单选题"），不跳过包含题目的行
    const types = ['判断题', '单选题', '多选题', '填空题', '简答题', '论述题', '名词解释', '计算题'];
    // 如果行只是标题（不包含编号、数字、选项等），认为是标题
    for (const type of types) {
      if (line === type || line === type + '：' || line === type + ':') {
        return true;
      }
    }
    // 章节标题格式：一、判断题  二、单选题  三、多选题
    // 匹配：以数字+顿号开头，后面是题型（可能带有分数信息如"（每题3分，共30分）"）
    if (line.match(/^[一二三四五六七八九十]+[、][判断单选多选填空简答论述名词计算]+题/)) {
      return true;
    }
    return false;
  }

  // 检测章节标题行（如：是 非题（每题3分，共30分）  单项选择题（每题4分，共40分）  一、判断题  二、单选题）
  isSectionTitle(content) {
    // 标题行特征：
    // 1. 包含"题"字（题型描述）
    // 2. 包含"每题"或"共"或"分"等分数描述
    // 3. 不包含选项标记（A、B、C、D）
    // 4. 不包含问号（题目才有问号）
    // 5. 不包含答案标记
    // 6. 或者是 "一、判断题" 格式的章节标题

    // 如果包含问号，认为是题目
    if (content.match(/[?？]/)) {
      return false;
    }

    // 如果包含选项，认为是题目
    if (content.match(/[A-D][、.]/)) {
      return false;
    }

    // 如果包含答案标记，认为是题目
    if (content.match(/^答案/)) {
      return false;
    }

    // 章节标题格式：一、二、判断题  或 三、多选题  或 三、判断题
    // 特征：以数字+顿号开头，后面是题型名称
    // 匹配：判断题、单选题、多选题、多项选择题、填空题、简答题等
    if (content.match(/^[一二三四五六七八九十]+[、](判断题|单选题|多选题|多项选择题|填空题|简答题|论述题|名词解释|计算题)/)) {
      return true;
    }

    // 标题特征：包含"题" + ("每题" 或 "共" 或 "分")
    const hasQuestionType = content.includes('题');
    const hasScoreInfo = content.includes('每题') || content.includes('共') || content.includes('分');

    if (hasQuestionType && hasScoreInfo) {
      return true;
    }

    return false;
  }

  matchQuestionNumber(line) {
    // 匹配：1. 2. 3. ... 或 1、2、... 或 一、二、三、...
    const patterns = [
      /^(\d+)\.\s+(.+)/,           // 1. 内容
      /^(\d+)[、.\s]\s*(.+)/,      // 1、内容 或 1. 内容
      /^([一二三四五六七八九十]+)[、.\s]\s*(.+)/ // 一、内容
    ];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        return { index: match[1], content: match[2] };
      }
    }
    return null;
  }

  matchOption(line) {
    // 匹配：A. 选项 或 A 选项 或 (A) 选项 或 A、选项（中文逗号）
    const patterns = [
      /^([A-D])\.\s+(.+)/,         // A. 内容
      /^([A-D])\s+(.+)/,           // A 内容
      /^\(([A-D])\)\s+(.+)/,       // (A) 内容
      /^([A-D])\s*\）\s+(.+)/,     // A）内容（中文右括号）
      /^([A-Z])[、，]\s*(.+?)(?=\s+[A-Z][、，]|$)/, // A、内容（非贪婪，到下个选项或行尾）
    ];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        return { letter: match[1], text: match[2].trim() };
      }
    }
    return null;
  }

  // 匹配一行中的多个选项（如：A、xxx     B、yyy     C、zzz）
  matchMultipleOptions(line) {
    const options = [];
    // 匹配所有 A、xxx 或 B、xxx 格式的选项（非贪婪）
    const regex = /([A-Z])[、，]\s*(.+?)(?=\s+[A-Z][、，]|$)/g;
    let match;
    while ((match = regex.exec(line)) !== null) {
      options.push(match[2].trim());
    }
    return options;
  }

  matchAnswer(line) {
    // 匹配：答案：A 或 答案：A,B 或 答案：√ 或 答：A 或 正确答案：B
    const patterns = [
      /^答案[:：]\s*(.+)/,
      /^答[:：]\s*(.+)/,
      /^正确答案[:：]\s*(.+)/,
      /^【答案】\s*(.+)/,
      /^答案\s*(.+)/,
      /^\[答案\]\s*(.+)/
    ];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        return { answer: match[1].trim() };
      }
    }
    return null;
  }

  processAnswer(question, answer) {
    // 判断题处理
    if (['√', '×', '正确', '错误', '对', '错'].includes(answer)) {
      question.type = 'true_false';
      question.answer = answer === '正确' || answer === '对' ? '√' :
                       answer === '错误' || answer === '错' ? '×' : answer;
    }
    // 单选题（单个字母或数字）
    else if (/^[A-D]$/.test(answer.toUpperCase())) {
      question.answer = answer.toUpperCase();
      question.type = 'single_choice';
    }
    // 多选题（逗号、顿号、空格分隔，或连续字母如 ABDE）
    else if (answer.includes(',') || answer.includes('、') || answer.includes(' ')) {
      question.type = 'multiple_choice';
      const letters = answer.split(/[,、\s]+/).map(a => a.toUpperCase()).filter(a => a);
      question.answer = letters.join(',');
    }
    // 多选题（连续字母组合，如 ABDE、CDF）
    else if (/^[A-Z]{2,}$/.test(answer.toUpperCase())) {
      question.type = 'multiple_choice';
      question.answer = answer.toUpperCase().split('').join(',');
    }
    // 其他情况（如填空题答案）
    else {
      question.answer = answer;
      question.type = 'single_choice'; // 默认为单选
    }
  }
}

module.exports = new WordParser();
