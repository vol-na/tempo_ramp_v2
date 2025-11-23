// version: 12

class RhythmMeditator {
    constructor() {
        // --- базовое состояние ---
        this.isRunning = false;
        this.isPaused = false;
        this.startTime = null;
        this.pausedTime = 0;
        this.duration = 5;            // длительность в минутах (по умолчанию 5)
        this.selectedSound = 6;       // выбранный звук (1, 2 или 3)
        this.minBpm = 10;             // минимальный BPM, на который спускается кривая и звук
        this.holdFrac = 0.15;         // доля плато на минимуме (15%)
        this.soundGain = { 1: 3.00, 2: 1.00, 3: 1.00, 4: 1.00, 5: 1.00, 6: 1.00, 7: 1.00 };

        // --- инициализация элементов DOM ---
        this.initializeElements();

        // начальные значения BPM из полей ввода
        const clamp = (v) => {
            const n = parseInt(v, 10);
            if (isNaN(n)) return this.minBpm;
            return Math.max(this.minBpm, Math.min(200, n));
        };
        this.startBpm = clamp(this.startBpmInput.value || 120);
        this.endBpm   = clamp(this.endBpmInput.value   || 80);
        this.currentBpm = this.startBpm;
        this.currentBpmDisplay.textContent = Math.round(this.currentBpm);

        // --- навешиваем события ---
        this.setupEventListeners();

        // --- аудио ---
        // контейнер для загруженных аудио-файлов тиков (звуки 4–7). Заполняется
        // при инициализации аудио при работе через http(s)
        this.soundBuffers = {};
        // кэш HTMLAudio для локального воспроизведения (звуки 4–7)
        this.audioEls = {};
        // флаг: если страница открыта через file://, используем HTMLAudio, а не fetch
        this.useHtmlAudio = (window.location.protocol === 'file:');
        // инициализация аудио должна происходить после определения soundBuffers/useHtmlAudio
        this.initializeAudio();
this.mp3Offset = 0.02; // 20 мс – безопасное смещение старта для MP3



        // --- кольцо прогресса (по кругу) ---
        this.progressRing = document.getElementById('progressRing');
        if (this.progressRing) {
            const r = this.progressRing.r.baseVal.value;
            this.ringCirc = 2 * Math.PI * r;
            this.progressRing.style.strokeDasharray = `${this.ringCirc} ${this.ringCirc}`;
            this.progressRing.style.strokeDashoffset = `${this.ringCirc}`;
        }

        // --- геометрия рампы ---
        // viewBox SVG: 0 0 560 360
        this.uiMin = 10;    // минимум на шкале
        this.uiMax = 150;   // максимум на шкале
        this.geom = {
            xL: 28,            // X левой рейки
            xR: 532,           // X правой рейки
            xC: 280,           // центр по X
            yTop: 40,          // верх рейки в координатах viewBox
            yBot: 360,         // нижняя точка (baseline) в координатах viewBox; совпадает с высотой
            vbH: 360           // высота viewBox для пересчёта из px
        };
        // функции перевода bpm <-> y
        this.bpmToY = (b) => {
            // ограничиваем
            const val = Math.max(this.uiMin, Math.min(this.uiMax, b));
            const t = (val - this.uiMin) / (this.uiMax - this.uiMin);
            return this.geom.yBot - t * (this.geom.yBot - this.geom.yTop);
        };
        this.yToBpm = (y) => {
            const clamped = Math.max(this.geom.yTop, Math.min(this.geom.yBot, y));
            const t = (this.geom.yBot - clamped) / (this.geom.yBot - this.geom.yTop);
            return Math.round(this.uiMin + t * (this.uiMax - this.uiMin));
        };

        // первичный рендер ползунков и кривой
        this.syncKnobsFromInputs();
        // отрисовываем точки вертикальных шкал
        this.drawRailDots();

        // обновляем состояние кнопок и иконок по умолчанию
        this.updateButtons();
    }

    // находим и сохраняем элементы DOM
    initializeElements() {
        // контролы
        this.durationCircles = document.querySelectorAll('[data-duration]');
        this.soundCircles    = document.querySelectorAll('[data-sound]');
        // единая кнопка старт/пауза
        this.toggleBtn       = document.getElementById('toggleBtn');
        // кнопка стоп
        this.stopBtn         = document.getElementById('stopBtn');
        this.timeElapsed     = document.getElementById('timeElapsed');
        this.timeTotal       = document.getElementById('timeTotal');
        this.currentBpmDisplay = document.getElementById('pulseBpm');
        this.progressBar       = document.getElementById('progress');
        this.startBpmInput     = document.getElementById('startBpmInput');
        this.endBpmInput       = document.getElementById('endBpmInput');

        this.infoBtn = document.getElementById('infoBtn'); // кнопка i в нижней строке
        this.tgBtn   = document.getElementById('tgBtn');  // кнопка tg в нижней строке


        // элементы рампы
        this.rampSvg    = document.getElementById('rampSvg');
        this.rampPath   = document.getElementById('rampPath');
        this.leftKnob   = document.getElementById('leftKnob');
        this.rightKnob  = document.getElementById('rightKnob');
        this.leftLabel  = document.getElementById('leftLabel');
        this.rightLabel = document.getElementById('rightLabel');

        // группы точек для вертикальных шкал (если используются)
        this.railLGroup = document.getElementById('railL');
        this.railRGroup = document.getElementById('railR');

        // элементы прогресса по дуге
        this.rampProgress = document.getElementById('rampProgress');
        this.rampCursor   = document.getElementById('rampCursor');

        // элемент пульса (круг), который будет пульсировать
        this.pulseCircle = document.getElementById('pulse');
    }

    // навешиваем обработчики событий
    setupEventListeners() {
        // выбор длительности (минуты)
        this.durationCircles.forEach(btn => {
            btn.addEventListener('click', () => {
                this.duration = parseInt(btn.getAttribute('data-duration'), 10);
                this.updateActiveCircle(this.durationCircles, btn);
                this.updateTimeUi(0);
            });
        });
        // выбор звука
        this.soundCircles.forEach(btn => {
            btn.addEventListener('click', () => {
                this.selectedSound = parseInt(btn.getAttribute('data-sound'), 10);
                this.updateActiveCircle(this.soundCircles, btn);
            });
        });
        // кнопки управления
        if (this.toggleBtn) {
            // единая кнопка: старт при неработающем или пауза/продолжить при работающем
            this.toggleBtn.addEventListener('click', () => {
                if (!this.isRunning || this.isPaused) {
                    this.start();
                } else {
                    this.togglePause();
                }
            });
        }
        if (this.stopBtn)  this.stopBtn.addEventListener('click',  () => this.stop());

        // кнопка "i"
        if (this.infoBtn) {
            this.infoBtn.addEventListener('click', () => {
                window.open('https://example.com/info', '_blank');
            });
        }

        // кнопка "tg"
        if (this.tgBtn) {
            this.tgBtn.addEventListener('click', () => {
                window.open('https://t.me/volodina_natascia', '_blank');
            });
        }

        // поля ввода bpm
        const clamp = (v) => {
            const n = parseInt(v, 10);
            if (isNaN(n)) return this.minBpm;
            return Math.max(this.minBpm, Math.min(200, n));
        };
        const onBpmChange = () => {
            this.startBpm = clamp(this.startBpmInput.value);
            this.endBpm   = clamp(this.endBpmInput.value);
            this.startBpmInput.value = this.startBpm;
            this.endBpmInput.value   = this.endBpm;
            // когда метроном не работает, показываем стартовый bpm
            if (!this.isRunning) {
                this.currentBpm = this.startBpm;
                this.currentBpmDisplay.textContent = Math.round(this.currentBpm);
            }
            this.syncKnobsFromInputs();
        };
        if (this.startBpmInput) this.startBpmInput.addEventListener('input', onBpmChange);
        if (this.endBpmInput)   this.endBpmInput.addEventListener('input',   onBpmChange);

        // drag-and-drop для ползунков
        const startDrag = (knob, onChange) => {
            const move = (e) => {
                const pt = e.touches && e.touches[0] ? e.touches[0] : e;
                const rect = this.rampSvg.getBoundingClientRect();
                // пересчёт из пикселей DOM в координаты viewBox
                const yPx = pt.clientY - rect.top;
                const yVb = (yPx / rect.height) * this.geom.vbH;
                const yClamped = Math.max(this.geom.yTop, Math.min(this.geom.yBot, yVb));
                knob.setAttribute('cy', String(yClamped));
                onChange(this.yToBpm(yClamped));
            };
            const stop = () => {
                window.removeEventListener('mousemove', move);
                window.removeEventListener('touchmove', move);
                window.removeEventListener('mouseup', stop);
                window.removeEventListener('touchend', stop);
            };
            window.addEventListener('mousemove', move, { passive: false });
            window.addEventListener('touchmove', move, { passive: false });
            window.addEventListener('mouseup', stop);
            window.addEventListener('touchend', stop);
        };
        if (this.leftKnob) {
            this.leftKnob.addEventListener('mousedown', () => {
                startDrag(this.leftKnob, (val) => {
                    this.startBpm = val;
                    this.startBpmInput.value = val;
                    this.leftLabel.textContent = String(val);
                    this.leftLabel.setAttribute('y', String(this.bpmToY(val)));
                    if (!this.isRunning) {
                        this.currentBpm = this.startBpm;
                        this.currentBpmDisplay.textContent = Math.round(this.currentBpm);
                    }
                    this.drawRamp();
                });
            });
            this.leftKnob.addEventListener('touchstart', (e) => {
                e.preventDefault();
                startDrag(this.leftKnob, (val) => {
                    this.startBpm = val;
                    this.startBpmInput.value = val;
                    this.leftLabel.textContent = String(val);
                    this.leftLabel.setAttribute('y', String(this.bpmToY(val)));
                    if (!this.isRunning) {
                        this.currentBpm = this.startBpm;
                        this.currentBpmDisplay.textContent = Math.round(this.currentBpm);
                    }
                    this.drawRamp();
                });
            });
        }
        if (this.rightKnob) {
            this.rightKnob.addEventListener('mousedown', () => {
                startDrag(this.rightKnob, (val) => {
                    this.endBpm = val;
                    this.endBpmInput.value = val;
                    this.rightLabel.textContent = String(val);
                    this.rightLabel.setAttribute('y', String(this.bpmToY(val)));
                    this.drawRamp();
                });
            });
            this.rightKnob.addEventListener('touchstart', (e) => {
                e.preventDefault();
                startDrag(this.rightKnob, (val) => {
                    this.endBpm = val;
                    this.endBpmInput.value = val;
                    this.rightLabel.textContent = String(val);
                    this.rightLabel.setAttribute('y', String(this.bpmToY(val)));
                    this.drawRamp();
                });
            });
        }
    }

    // подсветка активного круга
    updateActiveCircle(group, activeEl) {
        group.forEach(el => el.classList.remove('active'));
        activeEl.classList.add('active');
    }

    /**
     * Воспроизводит внешний аудиофайл для звуков с id 4–7 через HTMLAudio.
     * Файлы должны называться sound4.mp3, sound5.mp3 и т.д. и находиться
     * рядом с index.html. Элементы кэшируются в this.audioEls.
     * @param {number} id — номер звука (4..7)
     */
    playSample(id) {
        const file = `sound${id}.mp3`;
        // Создание и кэширование HTMLAudio
        if (!this.audioEls[id]) {
            const audio = new Audio(file);
            audio.preload = 'auto';
            audio.volume = 1.0;
            this.audioEls[id] = audio;
        }
        const audio = this.audioEls[id];
        try {
            audio.pause();
// сдвигаем старт, как в «тихой» первой версии
try { audio.currentTime = this.mp3Offset; } catch(e) {}
audio.play().catch(() => {});

        } catch (e) {
            // тихий fallback: если воспроизведение не удалось, ничего не делаем
        }
    }

    /**
     * Рисует вертикальные рейки как набор точек с постепенно
     * увеличивающимся интервалом. Точки строятся один раз при
     * инициализации, исходя из текущей геометрии (yTop,yBot,xL,xR).
     * Использует радиальный градиент railDotGrad, определённый в SVG.
     */
    drawRailDots() {
        const build = (group, x) => {
            if (!group) return;
            // очистить существующие точки
            group.innerHTML = '';
            const { yTop, yBot } = this.geom;
            const height = yBot - yTop;
            // параметры разрежения: минимальный и максимальный шаг (в px viewBox)
            const minGap = 2.0;   // на самом верху точки почти сливаются
            const maxGap = 22.0;  // внизу точки разрежены
            const exponent = 2.2; // степень роста шага (2–3 даёт плавный переход)
            let y = yTop;
            let t;
            // генерируем точки пока не уйдём за нижнюю границу
            while (y < yBot) {
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', String(x));
                circle.setAttribute('cy', String(y));
                circle.setAttribute('r', '2');
                group.appendChild(circle);
                // нормированный прогресс по высоте 0..1
                t = (y - yTop) / height;
                // вычисляем интервал: от minGap до maxGap с плавным возрастанием
                const gap = minGap + (maxGap - minGap) * Math.pow(t, exponent);
                y += gap;
            }
        };
        // строим для левой и правой группы
        build(this.railLGroup, this.geom.xL);
        build(this.railRGroup, this.geom.xR);
    }

    /**
     * Запускает анимацию пульса на круге. Задаёт длительность
     * анимации в миллисекундах так, чтобы затухание совпадало
     * с интервалом между звуками. При каждом вызове класс
     * .active удаляется и добавляется заново для перезапуска
     * CSS‑анимации.
     * @param {number} durationMs Длительность анимации в миллисекундах
     */
    animatePulse(durationMs) {
        if (!this.pulseCircle) return;
        const el = this.pulseCircle;
        // сброс предыдущей анимации
        el.classList.remove('active');
        // принудительный reflow, чтобы браузер распознал удаление класса
        void el.offsetWidth;
        // устанавливаем длительность анимации через inline‑стиль
        el.style.animationDuration = `${durationMs}ms`;
        // добавляем класс для запуска анимации
        el.classList.add('active');
    }

    // обновляем прогресс по кругу
    updateProgressArc(p) {
        if (!this.progressRing || !this.ringCirc) return;
        const clamped = Math.max(0, Math.min(1, p));
        this.progressRing.style.strokeDashoffset = String(this.ringCirc * (1 - clamped));
    }

    // синхронизация ползунков и кривой по значениям bpm
    syncKnobsFromInputs() {
        if (!this.leftKnob || !this.rightKnob) return;
        const yL = this.bpmToY(this.startBpm);
        const yR = this.bpmToY(this.endBpm);
        this.leftKnob.setAttribute('cy', String(yL));
        this.rightKnob.setAttribute('cy', String(yR));
        this.leftLabel.textContent  = String(this.startBpm);
        this.rightLabel.textContent = String(this.endBpm);
        this.leftLabel.setAttribute('y', String(yL));
        this.rightLabel.setAttribute('y', String(yR));
        this.drawRamp();
    }

    // рисуем U‑кривую (две квадратичные), а также подготавливаем прогресс по дуге
    drawRamp() {
        if (!this.rampPath) return;
        const yL = this.bpmToY(this.startBpm);
        const yR = this.bpmToY(this.endBpm);
        const yB = this.geom.yBot;
        const xL = this.geom.xL;
        const xC = this.geom.xC;
        const xR = this.geom.xR;
        // U‑кривая: две квадратичные части, чтобы дно было на baseline
        const d = `M ${xL},${yL} Q ${xL},${yB} ${xC},${yB} Q ${xR},${yB} ${xR},${yR}`;
        // основная кривая (серый контур)
        this.rampPath.setAttribute('d', d);

        // если есть элементы для прогресса, синхронизируем их
        if (this.rampProgress) {
            // задать тот же путь для прогрессной кривой
            this.rampProgress.setAttribute('d', d);
            // вычислить длину пути (в SVG координатах)
            // берем длину у rampPath, потому что path уже установлен
            const len = this.rampPath.getTotalLength();
            this.rampLen = len;
            // strokeDasharray: длина+длина для плавного заполнения
            // выставляем штриховку через атрибуты, чтобы она корректно применялась в SVG
            this.rampProgress.setAttribute('stroke-dasharray', `${len} ${len}`);
            // по умолчанию прогресс скрыт (полностью смещен)
            this.rampProgress.setAttribute('stroke-dashoffset', `${len}`);
        }
        // позиционируем курсор в начальной точке
        if (this.rampCursor && this.rampPath) {
            const startPt = this.rampPath.getPointAtLength(0);
            this.rampCursor.setAttribute('cx', String(startPt.x));
            this.rampCursor.setAttribute('cy', String(startPt.y));
        }
    }

    // формат времени mm:ss
    formatTime(totalSeconds) {
        const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }

    // обновить таймер и колечко
    updateTimeUi(elapsedSec) {
        const total = this.duration * 60;
        if (this.timeElapsed) this.timeElapsed.textContent = this.formatTime(elapsedSec);
        if (this.timeTotal)   this.timeTotal.textContent   = this.formatTime(total);
        if (this.progressRing && this.ringCirc) {
            const p = Math.min(1, elapsedSec / total);
            this.progressRing.style.strokeDashoffset = String(this.ringCirc * (1 - p));
        }
        // обновляем линейный прогресс бар, если он есть
        if (this.progressBar) {
            const pBar = Math.min(1, elapsedSec / (this.duration * 60));
            this.progressBar.style.width = `${pBar * 100}%`;
        }

        // --- прогресс по дуге (тайм‑бар на кривой) ---
        if (this.rampProgress && this.rampPath && this.rampLen) {
            const total = this.duration * 60;
            const pr = Math.min(1, Math.max(0, elapsedSec / total));
            // перемещаем штриховку: по мере роста pr смещаем отступ влево
            this.rampProgress.setAttribute('stroke-dashoffset', String(this.rampLen * (1 - pr)));
            // перемещаем курсор вдоль пути
            if (this.rampCursor) {
                const pt = this.rampPath.getPointAtLength(this.rampLen * pr);
                this.rampCursor.setAttribute('cx', String(pt.x));
                this.rampCursor.setAttribute('cy', String(pt.y));
            }
        }
    }

    // аудио
    async initializeAudio() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.audioContext.createGain();
            // небольшая громкость по умолчанию
            this.masterGain.gain.value = 0.05;
            this.masterGain.connect(this.audioContext.destination);

            // При открытии файла через file:// браузер блокирует fetch/decodeAudioData. В этом случае
            // мы не загружаем аудиофайлы здесь: воспроизведение будет через HTMLAudio в playTick().
            if (this.useHtmlAudio) {
                return;
            }

            // ---- Загрузка аудио-файлов для дополнительных звуков ----
            // Для звуков с id 4–7 мы используем предварительно загруженные аудиофайлы.
            // Эти файлы должны находиться в той же папке, что и index.html.
            const fileMap = {
                4: 'sound4.mp3',
                5: 'sound5.mp3',
                6: 'sound6.mp3',
                7: 'sound7.mp3'
            };
            for (const key of Object.keys(fileMap)) {
                const id = parseInt(key, 10);
                const url = fileMap[id];
                try {
                    const resp = await fetch(url);
                    if (!resp.ok) {
                        console.warn(`Не удалось загрузить файл звука ${url}: ${resp.status}`);
                        continue;
                    }
                    const arrayBuffer = await resp.arrayBuffer();
                    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
                    this.soundBuffers[id] = audioBuffer;
                } catch (e) {
                    console.warn('Ошибка загрузки или декодирования аудиофайла', url, e);
                }
            }
        } catch (error) {
            console.error('Ошибка инициализации аудио:', error);
        }
    }
        
// === ЗАМЕНА МЕТОДА === 1 — синтез как в предыдущей версии; 2–7 — сначала MP3, если не вышло — тот же синтез, что у 1
playTick(now = this.audioContext?.currentTime ?? 0) {
    const rawId = this.selectedSound;   // что выбрал пользователь
    const id = rawId;                   // маппинг не нужен — 1 синтез, 2–7 файлы

    if (id === 1) {
        // 1) Всегда синтез — как сейчас
        this.synthClick1(now);
        return;
    }

    // 2) Для 2–7: сперва пробуем MP3, если не получилось — синтетический «1»
    this.playMp3V1(id);

}

// === НОВЫЙ ХЕЛПЕР 1: синтез «первого» звука без изменений по смыслу ===
// Использует ту же огибающую и частоту, что и ваш текущий звук 1.
synthClick1(now) {
    if (!this.audioContext || !this.masterGain) return;

    const osc  = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    // Частота «1»: 440 Гц (как у вас сейчас)
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);

    // Калибровка громкости по карте (если задали this.soundGain[1])
    const calibration = (this.soundGain?.[1] || 1);
    const peak = Math.min(1, 0.2 * calibration);   // ваш текущий пик был ~0.2

    // Экспоненциальная короткая огибающая: быстрый удар и спад ~80 мс
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);

    osc.connect(gain).connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.1);
}

playMp3V1(id) {
    // sound2.mp3 ... sound7.mp3 должны лежать рядом с index.html
    try {
        const a = new Audio(`sound${id}.mp3`);
        a.preload = 'auto';
        // лёгкий сдвиг старта, чтобы избежать «клаца» на нуле
        try { a.currentTime = this.mp3Offset ?? 0.02; } catch(e) {}
        // калибровка уровня (если используется карта громкостей)
        const calibration = (this.soundGain?.[id] || 1);
        a.volume = Math.min(1, 1.0 * calibration);

        const p = a.play();
        if (p && p.catch) p.catch(() => {
            this.synthClick1(this.audioContext?.currentTime ?? 0);
        });
        a.addEventListener('error', () => {
            this.synthClick1(this.audioContext?.currentTime ?? 0);
        }, { once: true });
    } catch {
        this.synthClick1(this.audioContext?.currentTime ?? 0);
    }
}


// === НОВЫЙ ХЕЛПЕР 2: попытка проиграть файл (2–7) с fallback на synth «1» ===
playFileOrFallback(id, now) {
    // Вариант А: работаем по http(s) и буфер уже загружен/декодирован — играем через WebAudio
    const hasBuffer = !this.useHtmlAudio && this.soundBuffers && this.soundBuffers[id];
    if (hasBuffer && this.audioContext && this.masterGain) {
        try {
            const buffer = this.soundBuffers[id];
            const source = this.audioContext.createBufferSource();
            source.buffer = buffer;

            // Короткая огибающая через GainNode, чтобы «тик» был аккуратный
            const gainNode = this.audioContext.createGain();
            const calibration = (this.soundGain?.[id] || 1);
            const peak = Math.min(1, 1.0 * calibration);

            gainNode.gain.setValueAtTime(0.0001, now);
            gainNode.gain.exponentialRampToValueAtTime(peak, now + 0.003);
            const dur = buffer.duration;
            gainNode.gain.exponentialRampToValueAtTime(0.0001, now + dur);

            source.connect(gainNode).connect(this.masterGain);
            const startOffset = 0.005; // 5 мс – безопасный сдвиг
            source.start(now, startOffset);
            return; // успех — выходим
        } catch (e) {
            // если что-то пошло не так — проваливаемся в fallback
        }
    }

    // Вариант Б: локально (file://) или буфера нет — используем HTMLAudio с fallback
    try {
        if (!this.audioEls) this.audioEls = {};
        if (!this.audioEls[id]) {
            const a = new Audio(`sound${id}.mp3`);
            a.preload = 'auto';
            this.audioEls[id] = a;
        }
        const audio = this.audioEls[id];

        // Калибровка громкости (на случай, если у сэмпла уровень ниже/выше)
        const calibration = (this.soundGain?.[id] || 1);
        audio.volume = Math.min(1, 1.0 * calibration);

        // Сброс и попытка сыграть
        audio.pause();
        audio.currentTime = this.mp3Offset;

        // fallback, если не проигралось
        let fallbackDone = false;
        const fallback = () => {
            if (fallbackDone) return;
            fallbackDone = true;
            this.synthClick1(this.audioContext?.currentTime ?? 0);
        };

        // Если браузер не сможет начать — упадём в catch
        audio.play().catch(fallback);

        // На всякий случай: если файл отсутствует/битый — сработает error
        const onErrorOnce = () => { audio.removeEventListener('error', onErrorOnce); fallback(); };
        audio.addEventListener('error', onErrorOnce, { once: true });

        // Если не начнёт играть довольно быстро — подстрахуемся таймаутом
        setTimeout(() => {
            // readyState < 2 обычно значит, что воспроизведение не стартовало
            if (!fallbackDone && audio.readyState < 2) fallback();
        }, 300);
    } catch {
        // В крайнем случае — синтез
        this.synthClick1(this.audioContext?.currentTime ?? 0);
    }
}





    // расчёт текущего bpm на основе прогресса
    calculateBpm(elapsedSec) {
        const T = this.duration * 60;
        const p = Math.max(0, Math.min(1, elapsedSec / T));
        const minBpm = this.minBpm;
        const start = Math.max(minBpm, this.startBpm);
        const end   = Math.max(minBpm, this.endBpm);
        const f = Math.min(0.5, Math.max(0, this.holdFrac));
        const L = (1 - f) / 2;
        if (p < L) {
            const t = p / L;
            const eased = 1 - t * t;
            return minBpm + (start - minBpm) * eased;
        } else if (p < L + f) {
            return minBpm;
        } else {
            const t = (p - L - f) / L;
            const eased = t * t;
            return minBpm + (end - minBpm) * eased;
        }
    }

    // планирование следующего тика
    scheduleNextTick(elapsedSec) {
        const bpm = this.calculateBpm(elapsedSec);
        const intervalMs = 60000 / bpm;
        this.currentBpmDisplay.textContent = Math.round(bpm);
        this.playTick();
        // запускаем визуальный пульс с длительностью интервала между тиками
        this.animatePulse(intervalMs);
        this.tickTimeout = setTimeout(() => {
            if (!this.isRunning || this.isPaused) return;
            const nowElapsed = (Date.now() - this.startTime - this.pausedTime) / 1000;
            if (nowElapsed >= this.duration * 60) {
                this.stop();
                return;
            }
            this.scheduleNextTick(nowElapsed);
        }, intervalMs);
    }

    // основной цикл: обновляет прогресс и время каждую анимацию
    loop() {
        const step = () => {
            if (!this.isRunning) return;
            const elapsed = (Date.now() - this.startTime - this.pausedTime) / 1000;
            this.updateTimeUi(elapsed);
            this.animId = requestAnimationFrame(step);
        };
        this.animId = requestAnimationFrame(step);
    }

    // запуск метронома
    start() {
        if (this.isRunning && !this.isPaused) return;
        // если до этого пауза, то продолжить
        if (this.isPaused) {
            this.isPaused = false;
            this.pausedTime += Date.now() - this.pauseStart;
            this.audioContext?.resume();
            const elapsed = (Date.now() - this.startTime - this.pausedTime) / 1000;
            this.scheduleNextTick(elapsed);
            this.loop();
        } else {
            // начало сначала
            this.startTime = Date.now();
            this.pausedTime = 0;
            this.isRunning = true;
            this.isPaused  = false;
            this.audioContext?.resume();
            this.currentBpm = this.startBpm;
            this.scheduleNextTick(0);
            this.loop();
        }
        // обновим кнопки
        this.updateButtons();
    }

    // пауза / продолжение
    togglePause() {
        if (!this.isRunning) return;
        if (!this.isPaused) {
            this.isPaused = true;
            this.pauseStart = Date.now();
            this.audioContext?.suspend();
            clearTimeout(this.tickTimeout);
            cancelAnimationFrame(this.animId);
        } else {
            this.isPaused = false;
            this.pausedTime += Date.now() - this.pauseStart;
            this.audioContext?.resume();
            const elapsed = (Date.now() - this.startTime - this.pausedTime) / 1000;
            this.scheduleNextTick(elapsed);
            this.loop();
        }
        this.updateButtons();
    }

    // остановка метронома
    stop() {
        if (!this.isRunning) return;
        this.isRunning = false;
        this.isPaused  = false;
        clearTimeout(this.tickTimeout);
        cancelAnimationFrame(this.animId);
        this.audioContext?.suspend();
        // сброс прогресса
        this.updateTimeUi(0);
        this.currentBpm = this.startBpm;
        this.currentBpmDisplay.textContent = Math.round(this.currentBpm);
        if (this.progressRing && this.ringCirc) {
            this.progressRing.style.strokeDashoffset = `${this.ringCirc}`;
        }
        if (this.progressBar) this.progressBar.style.width = '0%';
        // сброс прогресса на кривой и курсора
        if (this.rampProgress && this.rampLen) {
            this.rampProgress.setAttribute('stroke-dashoffset', `${this.rampLen}`);
        }
        if (this.rampCursor && this.rampPath) {
            const startPt = this.rampPath.getPointAtLength(0);
            this.rampCursor.setAttribute('cx', String(startPt.x));
            this.rampCursor.setAttribute('cy', String(startPt.y));
        }
        this.updateButtons();
    }

    // обновляем состояние кнопок и иконок в зависимости от работы метронома
    updateButtons() {
        // единая кнопка: меняем иконку в зависимости от состояния и всегда оставляем активной
        if (this.toggleBtn) {
            if (this.isRunning && !this.isPaused) {
                this.setToggleIcon('playing');
            } else {
                this.setToggleIcon('paused');
            }
            this.toggleBtn.disabled = false;
        }
        // стоп активен только когда идёт метроном
        if (this.stopBtn)  this.stopBtn.disabled  = !this.isRunning;
    }

    /**
     * Обновляет иконку на переключателе старт/пауза.
     * @param {string} state 'playing' или 'paused'
     */
    setToggleIcon(state) {
        if (!this.toggleBtn) return;
        const iconSpan = this.toggleBtn.querySelector('.icon');
        if (!iconSpan) return;
        if (state === 'playing') {
            // иконка паузы (❚❚)
            iconSpan.textContent = '❚❚';
            this.toggleBtn.dataset.state = 'playing';
            this.toggleBtn.setAttribute('aria-label', 'Пауза');
        } else {
            // иконка старта (▶)
            iconSpan.textContent = '▶';
            this.toggleBtn.dataset.state = 'paused';
            this.toggleBtn.setAttribute('aria-label', 'Старт');
        }
    }
}

// инициализируем после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    window.app = new RhythmMeditator();
});