function renderQuestions() {
  const questions = (examData && examData.questions) ? examData.questions : [];
  const questionArea = document.getElementById('questionArea');

  if (questions.length === 0) {
    questionArea.innerHTML = '<div class="text-center" style="padding:40px;color:#999;">暂无题目</div>';
    return;
  }

  questionArea.innerHTML = questions.map((q, index) => {
    // 类型文本
    let typeText = '题目';
    if (q.type === 'true_false') typeText = '判断题';
    else if (q.type === 'single_choice') typeText = '单选题';
    else if (q.type === 'multiple_choice') typeText = '多选题';

    // 选项处理：判断题如果没有 options，使用 ["√","×"]
    const options = (q.options && q.options.length > 0) ? q.options : (q.type === 'true_false' ? ['√', '×'] : []);

    const optionsHtml = options.map((opt, idx) => {
      const optionLabel = q.type === 'true_false' ? (idx === 0 ? '√' : '×') : String.fromCharCode(65 + idx); // A, B, C, D or √, ×
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
          ${optionsHtml || '<p style="color:#999;">无选项</p>'}
        </div>
      </div>
    `;
  }).join('');

  // 更新题目总数
  document.getElementById('totalQuestions').textContent = questions.length;

  // 恢复已保存的答案
  loadSavedAnswers();
}
