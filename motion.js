/* ══════════════════════════════════════════════════════════════════════
   MOTION SYSTEM · 全站动效
   ──────────────────────────────────────────────────────────────────────
   想调手感只改下面这个 MOTION 对象，改完刷新浏览器即可（零构建）。
   缓动曲线本身在 motion.css 的 :root 里。

   依赖：GSAP + ScrollTrigger + Lenis（index.html 里用 CDN 引入，在本文件之前）
   暴露：window.Motion = { CONFIG, reduced, lenis, lerpFactor, reveal, gridParallax }
   ══════════════════════════════════════════════════════════════════════ */

const MOTION = {
  /* ── 平滑滚动 ── */
  scroll: {
    lerp: 0.1,              /* 越小越"重"、惯性越长；0.1 偏干脆，0.06 偏绵 */
    anchorDuration: 1.2,    /* 点导航锚点滚过去的秒数 */
  },

  /* ── 入场动画 ── */
  reveal: {
    rise: '40px',           /* 初始下沉距离 */
    durOpacity: '0.5s',     /* 透明度：快 */
    durTransform: '1.05s',  /* 位移：慢（两者之差就是"先显形再落定"的手感） */
    stagger: 0.06,          /* 同批进场的元素之间错开的秒数 */
    threshold: 0.12,        /* 露出多少比例才触发 */
    rootMargin: '0px 0px -8% 0px',   /* 底部内缩 8%，避免贴边就触发 */
  },

  /* ── 作品网格列视差（仅 4 列桌面端）──
     数值 = 滚过整个网格后该列累计漂移的像素；负值向上。
     正负交错才有错动感；幅度太大列会失去对齐。 */
  parallax: {
    cols: [-80, 60, -50, 40],
    scrub: 1,
  },

  /* ── 鼠标跟随的 lerp 系数（帧率无关，见 lerpFactor）──
     0.05–0.08 = 慢而黏；0.2–0.4 = 跟手 */
  follow: {
    cloudDrift: 0.06,       /* 品牌云转速向目标收敛的黏度 */
    cloudSteer: 0.012,      /* 鼠标偏移换算成转速的增益 */
  },
};

/* ══════════════════════════════════════════════════════════════════════ */

(function initMotion() {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canHover = window.matchMedia('(hover: hover)').matches;

  if (window.gsap && window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

  /* ── 把 MOTION.reveal 写进 CSS 变量 ──
     motion.css 里有同值兜底，所以这步只是让 MOTION 成为唯一调参入口。 */
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--m-rise', MOTION.reveal.rise);
  rootStyle.setProperty('--m-dur-opacity', MOTION.reveal.durOpacity);
  rootStyle.setProperty('--m-dur-transform', MOTION.reveal.durTransform);

  /* ════════════════════════════════════════════════════════════
     1 · 帧率无关的 lerp
     ────────────────────────────────────────────────────────────
     固定的 `v += (target - v) * 0.06` 在 120Hz 屏上会跑得整整快一倍。
     按实际帧间隔换算成等效系数，手感就和刷新率脱钩了。
     ════════════════════════════════════════════════════════════ */
  function lerpFactor(factor, dt) {
    /* dt 掉帧时会很大（切标签页回来可能是几百毫秒），夹一下免得过冲 */
    const d = Math.min(Math.max(dt, 1), 100);
    return 1 - Math.pow(1 - factor, d / 16.67);
  }

  /* ════════════════════════════════════════════════════════════
     2 · 平滑滚动
     ────────────────────────────────────────────────────────────
     reduced-motion 时不创建 Lenis，换一个同形状的壳子，
     这样调用处（灯箱、摆位模式）不用到处写条件分支。
     ════════════════════════════════════════════════════════════ */
  let lenis;

  if (reduced || !window.Lenis) {
    lenis = {
      stop() {}, start() {}, resize() {}, on() {}, raf() {},
      /* reduced-motion 下锚点直接跳到位，不做动画 */
      scrollTo(target) {
        const top = typeof target === 'number'
          ? target
          : (target.getBoundingClientRect().top + window.scrollY);
        window.scrollTo({ top, behavior: 'auto' });
      },
    };
  } else {
    lenis = new Lenis({ lerp: MOTION.scroll.lerp, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(time => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
    /* pin spacer 会在 Lenis 量完页面高度之后才改变它——
       每次 ScrollTrigger refresh 都重新量，否则滚动会被截断 */
    ScrollTrigger.addEventListener('refresh', () => lenis.resize());
    window.addEventListener('load', () => ScrollTrigger.refresh());
  }

  /* 页内锚点交给 Lenis，原生跳转会和平滑滚动打架（瞬跳、无惯性） */
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const href = a.getAttribute('href');

    if (href === '#') {                       /* 站名 logo → 回顶部 */
      e.preventDefault();
      lenis.scrollTo(0, { duration: MOTION.scroll.anchorDuration });
      return;
    }
    const target = document.querySelector(href);
    if (!target) return;
    e.preventDefault();
    lenis.scrollTo(target, { duration: MOTION.scroll.anchorDuration });
  });

  /* ════════════════════════════════════════════════════════════
     3 · 入场动画：IntersectionObserver + .is-in
     ────────────────────────────────────────────────────────────
     只触发一次。同一批进入视口的元素按文档顺序错开，
     所以网格里同一行的四张卡会依次落定，而不是整排一起跳出来。
     ════════════════════════════════════════════════════════════ */
  const watched = new WeakSet();

  function markIn(el, delay) {
    el.style.setProperty('--m-delay', delay + 's');

    if (reduced) {
      el.classList.add('is-in');
      return;
    }

    /* 先提升图层，下一帧再触发过渡，让浏览器有时间准备合成层 */
    el.classList.add('is-animating');
    requestAnimationFrame(() => el.classList.add('is-in'));

    /* 过渡结束立刻释放图层；transitionend 偶尔会丢，用定时器兜底 */
    const release = () => el.classList.remove('is-animating');
    const onEnd = ev => {
      if (ev.propertyName !== 'transform') return;   /* 等更慢的那条 */
      el.removeEventListener('transitionend', onEnd);
      release();
    };
    el.addEventListener('transitionend', onEnd);
    setTimeout(release, (delay + 2.5) * 1000);
  }

  const pending = new Set();   /* 已登记、尚未点亮的元素 */

  const io = new IntersectionObserver((entries, obs) => {
    const hits = entries.filter(en => en.isIntersecting).map(en => en.target);
    if (!hits.length) return;

    /* IO 不保证回调顺序，按文档顺序排一遍，stagger 才是自上而下的 */
    hits.sort((a, b) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);

    hits.forEach((el, i) => {
      obs.unobserve(el);
      pending.delete(el);
      markIn(el, i * MOTION.reveal.stagger);
    });
  }, {
    threshold: MOTION.reveal.threshold,
    rootMargin: MOTION.reveal.rootMargin,
  });

  /* 已经滚过去的元素直接点亮，不补播动画 */
  function lightUp(el) {
    pending.delete(el);
    io.unobserve(el);
    el.classList.add('is-in');
  }

  function observeOne(el) {
    if (el.getBoundingClientRect().bottom < 0) { lightUp(el); return; }
    pending.add(el);
    io.observe(el);
  }

  /* ── 兜底扫描 ──
     IO 单靠自己有两个盖不住的洞，都会让元素永久停在 opacity:0：

     1 跳跃式滚动（点锚点跳过整段内容）——元素从"视口下方"直接变成
       "视口上方"，两头交叉比例都是 0、都不相交，按规范 IO 不产生回调。
     2 页面最底部——rootMargin 把根的底边内缩了 8%，落在最后这 8% 里的
       元素（通常就是 footer）即使滚到底也永远等不到相交。

     所以滚动停下后扫一遍待处理集合：已经滚过去的直接点亮，滚不动了还
     露在视口里的正常播入场。集合清空后这段开销自然归零。 */
  function sweep() {
    if (!pending.size) return;
    const de = document.documentElement;
    const atBottom = window.scrollY + window.innerHeight >= de.scrollHeight - 2;
    let i = 0;

    [...pending].forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0) { lightUp(el); return; }          /* 洞 1 */
      if (atBottom && r.top < window.innerHeight) {       /* 洞 2 */
        pending.delete(el);
        io.unobserve(el);
        markIn(el, i++ * MOTION.reveal.stagger);
      }
    });
  }

  let sweepTimer = 0;
  window.addEventListener('scroll', () => {
    if (!pending.size) return;
    clearTimeout(sweepTimer);
    sweepTimer = setTimeout(sweep, 150);
  }, { passive: true });

  /* ── 必须等布局稳定才能开始观察 ──
     Hero 是 pinned 的，它的 pin spacer 要到 ScrollTrigger refresh 之后才把
     页面撑到最终高度。在那之前作品区紧贴在 100vh 的 Hero 下方，第一行会探进
     视口被判成"已可见"，于是入场动画在用户滚到之前就被消耗掉了。
     所以首屏的 observe 全部排队，等 load + refresh 之后再放行。 */
  let settled = false;
  const queue = [];

  window.addEventListener('load', () => {
    /* motion.js 里那个 load 监听器先注册，所以 ScrollTrigger.refresh()
       已经跑过；再等两帧让新高度真正进入布局 */
    requestAnimationFrame(() => requestAnimationFrame(() => {
      settled = true;
      queue.splice(0).forEach(observeOne);
      /* 刷新时浏览器可能恢复到页面底部，此时不会有 scroll 事件来触发扫描 */
      sweep();
    }));
  });

  /* root 传入容器可只处理新建的那部分 DOM（网格 resize 后会重建） */
  function reveal(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-reveal]').forEach(el => {
      if (el.classList.contains('is-in') || watched.has(el)) return;
      watched.add(el);
      settled ? observeOne(el) : queue.push(el);
    });
  }

  /* ════════════════════════════════════════════════════════════
     4 · 作品网格列视差
     ────────────────────────────────────────────────────────────
     只在 4 列（桌面）时启用；窄屏和 reduced-motion 直接跳过。
     只动 transform，不碰 top/margin，避免重排。
     ════════════════════════════════════════════════════════════ */
  function gridParallax(cols) {
    if (reduced || !cols || cols.length !== MOTION.parallax.cols.length) return;
    const grid = cols[0].parentElement;

    cols.forEach((col, i) => {
      const drift = MOTION.parallax.cols[i];
      if (!drift) return;
      gsap.to(col, {
        y: drift,
        ease: 'none',
        scrollTrigger: {
          trigger: grid,
          start: 'top bottom',
          end: 'bottom top',
          scrub: MOTION.parallax.scrub,
        },
      });
    });
  }

  window.Motion = {
    CONFIG: MOTION,
    reduced,
    canHover,
    lenis,
    lerpFactor,
    reveal,
    gridParallax,
  };
})();
