(() => {
  const navMenu = document.querySelector('.nav__menu');
  const navLinks = document.querySelector('.nav__links');

  if (navMenu && navLinks) {
    navMenu.addEventListener('click', () => {
      const expanded = navMenu.getAttribute('aria-expanded') === 'true';
      navMenu.setAttribute('aria-expanded', String(!expanded));
      navLinks.classList.toggle('is-open', !expanded);
    });

    navLinks.addEventListener('click', (event) => {
      if (event.target instanceof HTMLAnchorElement) {
        navMenu.setAttribute('aria-expanded', 'false');
        navLinks.classList.remove('is-open');
      }
    });
  }

  const reveals = document.querySelectorAll('.reveal');
  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.2,
    rootMargin: '0px 0px -10% 0px'
  });
  reveals.forEach((el) => observer.observe(el));

  let audioCtx;
  const visualizers = new Map();

  function getAudioContext() {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        console.warn('Web Audio API not supported in this browser.');
        return null;
      }
      audioCtx = new AudioContext();
    }
    return audioCtx;
  }

  function ensureContextRunning() {
    if (!audioCtx) return null;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {
        /* ignore */
      });
    }
    return audioCtx;
  }

  const createDrawingContext = (canvas) => {
    const context = canvas.getContext('2d');
    const update = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, rect.width * ratio);
      canvas.height = Math.max(1, rect.height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      return { width: rect.width, height: rect.height };
    };
    const size = update();
    return {
      context,
      width: size.width,
      height: size.height,
      update
    };
  };

  function ensureVisualizer(audio, canvas) {
    if (visualizers.has(audio)) {
      return visualizers.get(audio);
    }
    const ctx = getAudioContext();
    if (!ctx || !canvas) return null;
    const drawing = createDrawingContext(canvas);
    const source = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(ctx.destination);

    const entry = {
      audio,
      analyser,
      data: new Uint8Array(analyser.frequencyBinCount),
      canvas,
      ctx2d: drawing.context,
      width: drawing.width,
      height: drawing.height,
      updateSize: () => {
        const size = drawing.update();
        entry.width = size.width;
        entry.height = size.height;
      },
      animationId: null,
      active: false
    };

    const start = () => startVisualizer(entry);
    const stop = () => stopVisualizer(entry);
    audio.addEventListener('play', start);
    audio.addEventListener('pause', stop);
    audio.addEventListener('ended', stop);

    visualizers.set(audio, entry);
    return entry;
  }

  function startVisualizer(entry) {
    if (!entry || entry.active) return;
    entry.active = true;

    const render = () => {
      if (!entry.active) return;
      entry.analyser.getByteFrequencyData(entry.data);
      const { ctx2d, width, height, data } = entry;
      ctx2d.clearRect(0, 0, width, height);
      const bars = 64;
      const step = Math.max(1, Math.floor(data.length / bars));
      for (let i = 0; i < bars; i += 1) {
        const magnitude = data[i * step] / 255;
        const barHeight = magnitude * height * 0.9;
        const barWidth = width / bars;
        const x = i * barWidth;
        const y = height - barHeight;
        ctx2d.fillStyle = `rgba(${110 + i}, ${140 + Math.floor(70 * magnitude)}, 255, ${0.2 + magnitude * 0.6})`;
        ctx2d.fillRect(x, y, barWidth * 0.7, Math.max(2, barHeight));
      }
      entry.animationId = requestAnimationFrame(render);
    };

    render();
  }

  function stopVisualizer(entry) {
    if (!entry) return;
    entry.active = false;
    if (entry.animationId) {
      cancelAnimationFrame(entry.animationId);
      entry.animationId = null;
    }
    entry.ctx2d.clearRect(0, 0, entry.width, entry.height);
  }

  const heroAudio = document.getElementById('hero-audio');
  const heroCanvas = document.getElementById('hero-wave');
  const heroButton = document.querySelector('[data-preview-toggle]');

  if (heroAudio && heroCanvas && heroButton) {
    const heroEntry = ensureVisualizer(heroAudio, heroCanvas);

    const updateHeroLabel = (isPlaying) => {
      const textNode = heroButton.querySelector('span');
      const iconPath = heroButton.querySelector('svg path');
      if (textNode) {
        textNode.textContent = isPlaying ? 'Pause latest beat preview' : 'Play latest beat preview';
      }
      if (iconPath) {
        iconPath.setAttribute('d', isPlaying ? 'M8 5h3v14H8zm5 0h3v14h-3z' : 'M8 5v14l11-7z');
      }
    };

    heroButton.addEventListener('click', () => {
      const ctx = getAudioContext();
      if (!ctx) return;
      ensureContextRunning();
      if (heroAudio.paused) {
        heroAudio.currentTime = 0;
        heroAudio.play().catch(() => {/* ignore */});
      } else {
        heroAudio.pause();
      }
    });

    heroAudio.addEventListener('play', () => updateHeroLabel(true));
    heroAudio.addEventListener('pause', () => updateHeroLabel(false));

    if (heroEntry) {
      heroEntry.updateSize();
    }
  }

  const beatCards = document.querySelectorAll('[data-beat]');
  beatCards.forEach((card) => {
    const audio = card.querySelector('audio');
    const canvas = card.querySelector('canvas');
    const button = card.querySelector('button[data-play]');
    if (!audio || !canvas) return;
    const entry = ensureVisualizer(audio, canvas);

    const setButtonState = (isPlaying) => {
      if (!button) return;
      button.textContent = isPlaying ? 'Previewing…' : 'Tap to preview';
    };

    const play = () => {
      const ctx = getAudioContext();
      if (!ctx) return;
      ensureContextRunning();
      if (!audio.paused) return;
      audio.currentTime = 0;
      audio.play().then(() => {
        card.classList.add('is-active');
        setButtonState(true);
      }).catch(() => {
        setButtonState(false);
      });
    };

    const stop = () => {
      if (audio.paused) return;
      audio.pause();
      audio.currentTime = 0;
      card.classList.remove('is-active');
      setButtonState(false);
    };

    card.addEventListener('pointerenter', play);
    card.addEventListener('pointerleave', stop);
    card.addEventListener('focusin', play);
    card.addEventListener('focusout', stop);

    if (button) {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        if (audio.paused) {
          play();
        } else {
          stop();
        }
      });
    }

    if (entry) {
      entry.updateSize();
    }
  });

  window.addEventListener('resize', () => {
    visualizers.forEach((entry) => {
      entry.updateSize();
    });
  });

  window.addEventListener('blur', () => {
    document.querySelectorAll('audio').forEach((audio) => {
      if (!audio.paused) {
        audio.pause();
      }
    });
  });

  // Optional upgrade path: attach a WebGL or Canvas renderer using the `.webgl-ready` layer
  // and drive shader uniforms with analyser frequency data from `visualizers` for club-grade visuals.
})();
