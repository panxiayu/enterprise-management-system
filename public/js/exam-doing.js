// js/exam-doing.js - 答题逻辑完整修复版
let examData = null;
let answerId = null;
let timerInterval = null;

// 显示提示消息
function showToast(message, duration = 2000) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    document.body.removeChild(toast);
  }, duration);
}

// 生成临时 answerId（备用）
function generateTempAnswerId() {
  return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 渲染所有题目
function renderQuestions() {
  const questions = (examData && examData.questions) ? examData.questions : [];
  const questionArea = document.getElementById('questionArea');

  if (questions.length === 0) {
    questionArea.innerHTML = '<div class="text-center" style="padding:40px;color:#999;">暂无题目</div>';
    return;
  }

  questionArea.innerHTML = questions.map((q, index) => {
    let typeText = '题目';
    if (q.type === 'true_false') typeText = '判断题';
    else if (q.type === 'single_choice') typeText = '单选题';
    else if (q.type === 'multiple_choice') typeText = '多选题';

    const options = (q.options && q.options.length > 0) ? q.options : (q.type === 'true_false' ? ['√', '×'] : []);

    const optionsHtml = options.map((opt, idx) => {
      const optionLabel = q.type === 'true_false' ? (idx === 0 ? '√' : '×') : String.fromCharCode(65 + idx);
      return `
        <div class="option" data-question-id="${q._id}" data-option="${optionLabel}">
          <input type="${q.type === 'multiple_choice' ? 'checkbox' : 'radio'}"
                 name="q${q._id}"
                 value="${optionLabel}"
                 id="q${q._id}_${idx}">
          <label for="q${q._id}_${idx}">
            <strong>${optionLabel}.</strong> ${opt}
          </label>
        </div>
      `;
    }).join('');

    return `
      <div class="question-item" data-index="${index}" data-question-id="${q._id}">
        <div class="question-type">[${typeText}]</div>
        <div class="question-text">${index + 1}. ${q.content}</div>
        <div class="options">
          ${optionsHtml}
        </div>
      </div>
    `;
  }).join('');
}

// 显示指定索引的题目
function showQuestion(index) {
  const questions = document.querySelectorAll('.question-item');
  const total = questions.length;
  
  questions.forEach((q, i) => {
    q.style.display = i === index ? 'block' : 'none';
  });

  document.getElementById('currentIdx').textContent = index + 1;
  
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const submitBtn = document.getElementById('submitBtn');
  
  prevBtn.disabled = index === 0;
  
  if (index === total - 1) {
    nextBtn.style.display = 'none';
    submitBtn.style.display = 'block';
  } else {
    nextBtn.style.display = 'block';
    submitBtn.style.display = 'none';
  }
}

// 启动计时器
function startTimer(seconds) {
  const timeLeftEl = document.getElementById('timeLeft');
  
  function updateTimer() {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    timeLeftEl.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    if (seconds <= 0) {
      clearInterval(timerInterval);
      showToast('时间到，自动提交');
      submitExam(true);
      return;
    }

    seconds--;
  }

  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
}

// 上一题
function prevQuestion() {
  const currentIdx = parseInt(document.getElementById('currentIdx').textContent) - 1;
  if (currentIdx > 0) {
    showQuestion(currentIdx - 1);
  }
}

// 下一题
function nextQuestion() {
  const currentIdx = parseInt(document.getElementById('currentIdx').textContent) - 1;
  const total = examData.questions.length;
  if (currentIdx < total - 1) {
    showQuestion(currentIdx + 1);
  }
}

// 保存答案到 localStorage
function saveAnswers() {
  if (!answerId) return;
  const answers = {};
  
  document.querySelectorAll('.option input:checked').forEach(input => {
    const questionId = input.closest('.option').dataset.questionId;
    const qType = examData.questions.find(q => q._id === questionId).type;
    const value = input.value;

    if (qType === 'multiple_choice') {
      if (!answers[questionId]) answers[questionId] = [];
      if (!answers[questionId].includes(value)) {
        answers[questionId].push(value);
      }
    } else {
      answers[questionId] = value;
    }
  });

  localStorage.setItem(`answers_${examData.exam.id || examData.exam._id}`, JSON.stringify(answers));
}

// 加载已保存的答案
function loadSavedAnswers() {
  const saved = localStorage.getItem(`answers_${examData.exam.id || examData.exam._id}`);
  if (!saved) return;

  const answers = JSON.parse(saved);
  Object.keys(answers).forEach(questionId => {
    const answer = answers[questionId];
    
    if (Array.isArray(answer)) {
      answer.forEach(opt => {
        const optionEl = document.querySelector(`.option[data-question-id="${questionId}"][data-option="${opt}"]`);
        if (optionEl) {
          optionEl.querySelector('input').checked = true;
          optionEl.classList.add('selected');
        }
      });
    } else {
      const optionEl = document.querySelector(`.option[data-question-id="${questionId}"][data-option="${answer}"]`);
      if (optionEl) {
        optionEl.querySelector('input').checked = true;
        optionEl.classList.add('selected');
      }
    }
  });
}

// 提交考试
async function submitExam(skipConfirm = false) {
  if (!skipConfirm && confirm('确认提交试卷？提交后无法修改。')) {
    await doSubmit();
  } else if (skipConfirm) {
    await doSubmit();
  }
}

async function doSubmit() {
  clearInterval(timerInterval);

    const responses = examData.questions.map(q => {
      const answerInputs = document.querySelectorAll(`.option input:checked[data-question-id="${q._id}"]`);
      let userAnswer = '';

      if (answerInputs.length === 0) {
        userAnswer = '';
      } else if (q.type === 'multiple_choice') {
        const answers = Array.from(answerInputs).map(input => input.value).sort();
        userAnswer = answers.join(',');
      } else {
        userAnswer = answerInputs[0].value;
      }

      return {
        questionId: q._id,
        userAnswer: userAnswer
      };
    });

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = '提交中...';

    try {
      if (!answerId) {
        throw new Error('answerId 未设置，请重新开始考试');
      }
      const res = await api.submitExam(answerId, responses);
      const score = res.data.score;

      localStorage.removeItem(`answers_${examData.exam.id || examData.exam._id}`);

      window.location.href = `/result.html?score=${score}&answerId=${answerId}`;
    } catch (error) {
      showToast(error.message || '提交失败');
      submitBtn.disabled = false;
      submitBtn.textContent = '提交试卷';
    }
  }
}

// 绑定选项点击事件
document.addEventListener('click', (e) => {
  if (!examData || !examData.questions) return;

  const optionEl = e.target.closest('.option');
  if (!optionEl) return;

  const questionId = optionEl.dataset.questionId;
  const question = examData.questions.find(q => q._id === questionId);
  if (!question) return;
  const qType = question.type;

  if (qType === 'multiple_choice') {
    const checkbox = optionEl.querySelector('input[type="checkbox"]');
    checkbox.checked = !checkbox.checked;
    optionEl.classList.toggle('selected', checkbox.checked);
  } else {
    document.querySelectorAll(`.option[data-question-id="${questionId}"]`).forEach(opt => {
      opt.classList.remove('selected');
      opt.querySelector('input').checked = false;
    });
    optionEl.classList.add('selected');
    optionEl.querySelector('input').checked = true;
  }

  saveAnswers();
});

// 页面加载
document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const examId = urlParams.get('examId');

  if (!examId) {
    showToast('缺少考试 ID');
    setTimeout(() => {
      window.location.href = '/exam-list.html';
    }, 1500);
    return;
  }

  try {
    const res = await api.getExamDetail(examId);
    examData = res.data;
    console.log('examData:', examData);
    
    // 调用 startExam 获取 answerId
    try {
      const startRes = await api.startExam(examId);
      console.log("startExam response:", startRes);
      if (startRes.code === 0) {
        answerId = startRes.data.answerId;
        console.log('answerId:', answerId);
      } else {
        throw new Error(startRes.msg || '开始考试失败');
      }
    } catch (e) {
      console.error('startExam failed:', e);
      answerId = generateTempAnswerId();
      showToast('警告：未创建考试记录，提交可能失败');
    }

    renderQuestions();
    loadSavedAnswers();
    showQuestion(0);

    // 启动计时器
    const duration = examData.exam && examData.exam.duration;
    if (duration) {
      startTimer(duration * 60);
    } else {
      showToast('考试时长错误');
    }
  } catch (error) {
    console.error('加载考试失败:', error);
    showToast(error.message || '加载考试失败');
    setTimeout(() => {
      window.location.href = '/exam-list.html';
    }, 2000);
  }
});
