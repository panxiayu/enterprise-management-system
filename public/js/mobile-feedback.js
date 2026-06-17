// public/js/mobile-feedback.js - 移动端首页悬浮按钮（微信兼容版）
;(function() {
  if (window.__feedbackWidgetLoaded) return;
  window.__feedbackWidgetLoaded = true;

  try {
    // ============ 注入样式 ============
    var css = document.createElement('style');
    css.textContent = [
      '#feedback-fab{position:fixed;bottom:20px;right:12px;width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#4A90E2,#5B9EF4);display:flex;align-items:center;justify-content:center;z-index:997;cursor:pointer;touch-action:pan-y!important;-webkit-tap-highlight-color:transparent;transition:all .2s;box-shadow:0 4px 20px rgba(74,144,226,.45);border:none}',
      '#feedback-fab:active{transform:scale(.9)}',
      '#feedback-fab img{width:32px;height:32px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.15));pointer-events:none}'
    ].join('\n');
    document.head.appendChild(css);

    // ============ FAB 按钮 ============
    var fab = document.createElement('button');
    fab.id = 'feedback-fab';
    fab.setAttribute('aria-label', '返回首页');
    fab.innerHTML = '<img src="icons/icon-home.svg" width="32" height="32" />';
    document.body.appendChild(fab);

    // 初始化位置
    fab.style.right = '12px';
    fab.style.bottom = '20px';
    fab.style.position = 'fixed';
    fab.style.zIndex = '9997';

    // ============ FAB 拖拽功能 ============
    var fabState = {
      isDragging: false,
      startY: 0,
      currentBottom: 20,
      startX: 0
    };

    // 触摸开始
    fab.addEventListener('touchstart', function(e) {
      e.stopPropagation();
      fabState.isDragging = true;
      fabState.startY = e.touches[0].clientY;
      fabState.startX = e.touches[0].clientX;
      fabState.currentBottom = window.innerHeight - fab.getBoundingClientRect().bottom;
      fab.style.transition = 'none';
      fab.style.cursor = 'grabbing';
    }, { passive: true });

    // 触摸移动 - 拖拽时垂直移动FAB
    fab.addEventListener('touchmove', function(e) {
      if (!fabState.isDragging) return;
      e.preventDefault();
      e.stopPropagation();

      var touch = e.touches[0];
      var deltaY = touch.clientY - fabState.startY;
      var newBottom = fabState.currentBottom - deltaY;

      // 边界限制
      var minBottom = 20;
      var maxBottom = window.innerHeight - fab.offsetHeight - 20;
      newBottom = Math.max(minBottom, Math.min(maxBottom, newBottom));

      fab.style.bottom = newBottom + 'px';
    }, { passive: false });

    // 触摸结束
    fab.addEventListener('touchend', function(e) {
      if (!fabState.isDragging) return;
      fabState.isDragging = false;
      fab.style.cursor = 'grab';
      fab.style.transition = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
      fab.style.right = '12px';
    }, { passive: true });

    // PC 端鼠标拖拽支持
    fab.addEventListener('mousedown', function(e) {
      fabState.isDragging = true;
      fabState.startY = e.clientY;
      fabState.currentBottom = window.innerHeight - fab.getBoundingClientRect().bottom;
      fab.style.transition = 'none';
    });

    document.addEventListener('mousemove', function(e) {
      if (!fabState.isDragging) return;

      var deltaY = e.clientY - fabState.startY;
      var newBottom = fabState.currentBottom - deltaY;

      newBottom = Math.max(20, Math.min(window.innerHeight - fab.offsetHeight - 20, newBottom));

      fab.style.bottom = newBottom + 'px';
    });

    document.addEventListener('mouseup', function(e) {
      if (!fabState.isDragging) return;
      fabState.isDragging = false;
      fab.style.transition = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
      fab.style.right = '12px';
    });

    // ============ 双击计数 ============
    var lastClickTime = 0;
    var lastClickPageKey = '';

    var baseUrl = window.location.origin;

    // ============ FAB 点击/双击 ============
    fab.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();

      var now = Date.now();
      var path = window.location.pathname;
      var pageKey = path.split('/').pop().replace('.html', '').split('?')[0];

      var params = new URLSearchParams(window.location.search);

      // 单击：返回子系统list界面（当前页面则不跳转）
      var listPages = {
        'mobile-6s-add': '/mobile-6s-list.html',
        'mobile-6s-detail': '/mobile-6s-list.html',
        'mobile-6s-list': null,
        'mobile-6s-tasks': null,
        'mobile-exam-doing': '/mobile-exam-list.html',
        'mobile-exam-list': null,
        'mobile-learning-materials-detail': '/mobile-learning-materials-list.html',
        'mobile-learning-materials-list': null,
        'mobile-meal-view': '/mobile-meal-list.html',
        'mobile-meal-list': null,
        'mobile-voting': '/mobile-voting-list.html',
        'mobile-voting-result': '/mobile-voting-list.html',
        'mobile-voting-list': null,
        'mobile-training-list': null
      };

      // 双击（500ms内连续点击）：返回员工登录后的list界面
      if (lastClickPageKey === pageKey && now - lastClickTime < 500) {
        window.location.href = baseUrl + '/employee.html';
        lastClickTime = 0;
        lastClickPageKey = '';
        return;
      }

      lastClickTime = now;
      lastClickPageKey = pageKey;

      // 单击：返回子系统列表
      var listPage = listPages[pageKey];
      if (pageKey === 'mobile-6s-detail' && params.get('source') === 'task') {
        listPage = '/mobile-6s-tasks.html';
      }
      if (listPage) {
        window.location.href = baseUrl + listPage;
      }
      // else: listPages中为null的页面，单击不跳转
    });

  } catch(err) {
    console.error('home widget error:', err);
  }
})();
