
        // Construidos por partes para que el analizador embebido de HTML/JS del editor
        // no confunda estos literales con el cierre real de este bloque de script.
        function reScriptBlock() { return new RegExp('<' + 'script[\\s\\S]*?<\\/' + 'script>', 'gi'); }
        function reScriptOpenClose() { return new RegExp('<' + 'script(?![^>]*\\bsrc=)[^>]*>([\\s\\S]*?)<\\/' + 'script>', 'gi'); }
        /* ============================================================
           MOTOR GENÉRICO DE BALANCE: ( ) [ ] { }
           Ignora contenido dentro de strings y comentarios según el
           lenguaje (JS, CSS, PHP, SQL).
           ============================================================ */
        function analyzeBrackets(code, opts) {
            opts = opts || {};
            const lineComments = opts.lineComments || [];   // ej. ['//']
            const blockComments = opts.blockComments || []; // ej. [['/*','*/']]
            const allowBacktick = !!opts.allowBacktick;      // template literals JS
            const singleLineHash = !!opts.hashComments;      // # comentario (SQL/PHP)
            const pairsOpen = { '(': ')', '[': ']', '{': '}' };
            const pairsClose = { ')': '(', ']': '[', '}': '}'.replace('}','{') };
            // corregir mapping cierre -> apertura
            const closerToOpener = { ')': '(', ']': '[', '}': '{' };
            const stack = [];
            const errors = [];
            const warnings = [];
            let inString = null;   // caracter de comilla activa
            let stringStartLine = 1;
            let inLineComment = false;
            let inBlockComment = false;
            let blockCommentEnd = null;
            let line = 1;
            let i = 0;
            const n = code.length;
            while (i < n) {
                const ch = code[i];
                if (ch === '\n') {
                    line++;
                    inLineComment = false;
                    i++;
                    continue;
                }
                if (inLineComment) { i++; continue; }
                if (inBlockComment) {
                    if (code.substr(i, blockCommentEnd.length) === blockCommentEnd) {
                        inBlockComment = false;
                        i += blockCommentEnd.length;
                        continue;
                    }
                    i++; continue;
                }
                if (inString) {
                    if (ch === '\\') { i += 2; continue; }
                    if (ch === inString) { inString = null; }
                    i++; continue;
                }
                // detectar inicio de comentario de línea
                let matchedLineComment = false;
                for (const lc of lineComments) {
                    if (code.substr(i, lc.length) === lc) { inLineComment = true; i += lc.length; matchedLineComment = true; break; }
                }
                if (matchedLineComment) continue;
                if (singleLineHash && ch === '#') { inLineComment = true; i++; continue; }
                // detectar inicio de comentario de bloque
                let matchedBlockComment = false;
                for (const [open, close] of blockComments) {
                    if (code.substr(i, open.length) === open) {
                        inBlockComment = true; blockCommentEnd = close; i += open.length; matchedBlockComment = true; break;
                    }
                }
                if (matchedBlockComment) continue;
                if (ch === '"' || ch === "'" || (allowBacktick && ch === '`')) {
                    inString = ch; stringStartLine = line; i++; continue;
                }
                if (pairsOpen[ch]) { stack.push({ char: ch, line }); i++; continue; }
                if (closerToOpener[ch]) {
                    if (stack.length === 0) {
                        errors.push({ message: `Se encontró '${ch}' de cierre sin apertura correspondiente`, line });
                    } else {
                        const last = stack[stack.length - 1];
                        if (last.char === closerToOpener[ch]) {
                            stack.pop();
                        } else {
                            errors.push({ message: `Se esperaba '${pairsOpen[last.char]}' (abierto en línea ${last.line}) pero se encontró '${ch}'`, line });
                            stack.pop();
                        }
                    }
                    i++; continue;
                }
                i++;
            }
            if (inString) {
                warnings.push({ message: `Cadena de texto (comilla ${inString}) abierta en línea ${stringStartLine} parece no cerrarse correctamente`, line: stringStartLine });
            }
            stack.forEach(item => {
                errors.push({ message: `'${item.char}' abierto en línea ${item.line} nunca se cerró con '${pairsOpen[item.char]}'`, line: item.line });
            });
            return { errors, warnings };
        }
        /* ============================================================
           VALIDADOR DE ETIQUETAS HTML (balance y anidación)
           ============================================================ */
        class HTMLTagValidator {
            constructor() {
                this.voidElements = [
                    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
                    'link', 'meta', 'param', 'source', 'track', 'wbr'
                ];
            }
            analyze(html) {
                const results = {
                    isValid: true, errors: [], warnings: [],
                    tagCounts: {}, totalTags: 0, balancedTags: 0, unbalancedTags: 0
                };
                const cleanHtml = this.cleanHTML(html);
                const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
                const tags = [];
                let match;
                while ((match = tagRegex.exec(cleanHtml)) !== null) {
                    const fullTag = match[0];
                    const tagName = match[1].toLowerCase();
                    const isClosing = fullTag.startsWith('</');
                    const isSelfClosing = fullTag.endsWith('/>') || this.voidElements.includes(tagName);
                    tags.push({
                        name: tagName, fullTag, isClosing, isSelfClosing,
                        position: match.index, line: this.getLineNumber(cleanHtml, match.index)
                    });
                }
                this.countTags(tags, results);
                this.checkBalance(tags, results);
                this.checkNesting(tags, results);
                return results;
            }
            cleanHTML(html) {
                html = html.replace(/<!--[\s\S]*?-->/g, '');
                html = html.replace(reScriptBlock(), '');
                html = html.replace(/<style[\s\S]*?<\/style>/gi, '');
                html = html.replace(/<\?php[\s\S]*?\?>/g, '');
                html = html.replace(/<\?[\s\S]*?\?>/g, '');
                return html;
            }
            getLineNumber(text, position) { return text.substring(0, position).split('\n').length; }
            countTags(tags, results) {
                const counts = {};
                tags.forEach(tag => {
                    if (!counts[tag.name]) counts[tag.name] = { opening: 0, closing: 0, selfClosing: 0 };
                    if (tag.isSelfClosing) counts[tag.name].selfClosing++;
                    else if (tag.isClosing) counts[tag.name].closing++;
                    else counts[tag.name].opening++;
                });
                results.tagCounts = counts;
                results.totalTags = tags.length;
            }
            checkBalance(tags, results) {
                for (const [tagName, count] of Object.entries(results.tagCounts)) {
                    if (this.voidElements.includes(tagName)) {
                        if (count.opening + count.selfClosing > 0) results.balancedTags++;
                    } else {
                        if (count.opening === count.closing) {
                            results.balancedTags++;
                        } else {
                            results.unbalancedTags++;
                            results.isValid = false;
                            const diff = count.opening - count.closing;
                            results.errors.push({
                                message: diff > 0
                                    ? `La etiqueta <${tagName}> tiene ${diff} apertura(s) sin cerrar`
                                    : `La etiqueta <${tagName}> tiene ${Math.abs(diff)} cierre(s) extra`
                            });
                        }
                    }
                }
            }
            checkNesting(tags, results) {
                const stack = [];
                const nestingErrors = [];
                tags.forEach(tag => {
                    if (tag.isSelfClosing || this.voidElements.includes(tag.name)) return;
                    if (tag.isClosing) {
                        if (stack.length === 0) {
                            nestingErrors.push({ message: `Etiqueta de cierre </${tag.name}> encontrada sin apertura correspondiente`, line: tag.line });
                        } else {
                            const lastOpen = stack[stack.length - 1];
                            if (lastOpen.name === tag.name) stack.pop();
                            else nestingErrors.push({ message: `Anidamiento incorrecto: se esperaba </${lastOpen.name}> pero se encontró </${tag.name}>`, line: tag.line });
                        }
                    } else {
                        stack.push(tag);
                    }
                });
                stack.forEach(tag => {
                    nestingErrors.push({ message: `Etiqueta <${tag.name}> abierta en línea ${tag.line} nunca se cerró`, line: tag.line });
                });
                results.errors.push(...nestingErrors);
                if (nestingErrors.length > 0) results.isValid = false;
            }
        }
        /* ============================================================
           VALIDADOR PHP: balance de <?php ... ?> + llaves/paréntesis
           ============================================================ */
        function analyzePHPTags(code) {
            const errors = [];
            const warnings = [];
            const tagRegex = /<\?php|<\?=|<\?(?!xml)|\?>/gi;
            let match;
            const stack = [];
            while ((match = tagRegex.exec(code)) !== null) {
                const tag = match[0].toLowerCase();
                const line = code.substring(0, match.index).split('\n').length;
                if (tag === '?>') {
                    if (stack.length === 0) errors.push({ message: `Se encontró '?>' de cierre sin apertura PHP correspondiente`, line });
                    else stack.pop();
                } else {
                    stack.push({ tag, line });
                }
            }
            stack.forEach((item, idx) => {
                if (idx === stack.length - 1) {
                    warnings.push({ message: `Bloque abierto con '${item.tag}' en línea ${item.line} no tiene '?>' de cierre. Si es el final del archivo, esto es válido y recomendado en PHP puro (evita espacios en blanco accidentales); si no, revisa que falte el cierre.`, line: item.line });
                } else {
                    errors.push({ message: `Bloque '${item.tag}' abierto en línea ${item.line} nunca se cerró con '?>' antes de la siguiente apertura`, line: item.line });
                }
            });
            return { errors, warnings, opens: stack.length };
        }
        function analyzePHP(code) {
            const tagCheck = analyzePHPTags(code);
            const bracketCheck = analyzeBrackets(code, {
                lineComments: ['//'],
                blockComments: [['/*', '*/']],
                hashComments: true
            });
            return {
                errors: [...tagCheck.errors, ...bracketCheck.errors],
                warnings: [...tagCheck.warnings, ...bracketCheck.warnings]
            };
        }
        function analyzeCSS(code) {
            return analyzeBrackets(code, { blockComments: [['/*', '*/']] });
        }
        function analyzeJS(code) {
            return analyzeBrackets(code, {
                lineComments: ['//'],
                blockComments: [['/*', '*/']],
                allowBacktick: true
            });
        }
        /* ============================================================
           DETECCIÓN DE COMAS FALTANTES ENTRE COLUMNAS (CREATE TABLE)
           ============================================================ */
        function checkSQLMissingCommas(code) {
            const errors = [];
            const isDefinitionLike = str =>
                /^[`"[]?[a-zA-Z_][\w]*[`"\]]?\s+\S/.test(str) ||
                /^(PRIMARY|UNIQUE|FOREIGN|CONSTRAINT|KEY|INDEX|CHECK)\b/i.test(str);
            const createRegex = /CREATE\s+TABLE\b[^(]*\(/gi;
            let m;
            while ((m = createRegex.exec(code)) !== null) {
                let depth = 1;
                let i = m.index + m[0].length;
                const bodyStart = i;
                while (i < code.length && depth > 0) {
                    if (code[i] === '(') depth++;
                    else if (code[i] === ')') depth--;
                    i++;
                }
                const bodyEnd = i - 1;
                const body = code.slice(bodyStart, bodyEnd);
                const bodyStartLine = code.slice(0, bodyStart).split('\n').length;
                const rawLines = body.split('\n');
                let localDepth = 0;
                for (let li = 0; li < rawLines.length; li++) {
                    const codePart = rawLines[li].replace(/--.*$/, '');
                    const trimmed = codePart.trim();
                    for (const ch of codePart) {
                        if (ch === '(') localDepth++;
                        else if (ch === ')') localDepth--;
                    }
                    if (!trimmed || localDepth !== 0) continue;
                    if (/,\s*$/.test(trimmed)) continue;
                    let nextIdx = li + 1;
                    while (nextIdx < rawLines.length && !rawLines[nextIdx].replace(/--.*$/, '').trim()) nextIdx++;
                    if (nextIdx >= rawLines.length) continue;
                    const nextTrimmed = rawLines[nextIdx].replace(/--.*$/, '').trim();
                    if (isDefinitionLike(trimmed) && isDefinitionLike(nextTrimmed)) {
                        errors.push({
                            message: `Posiblemente falta una coma "," al final de esta línea: la siguiente parece iniciar una nueva columna o restricción`,
                            line: bodyStartLine + li
                        });
                    }
                }
            }
            return errors;
        }
        function analyzeSQL(code) {
            const bracketCheck = analyzeBrackets(code, {
                lineComments: ['--'],
                blockComments: [['/*', '*/']]
            });
            const commaErrors = checkSQLMissingCommas(code);
            return {
                errors: [...bracketCheck.errors, ...commaErrors],
                warnings: bracketCheck.warnings
            };
        }
        /* ============================================================
           DETECCIÓN AUTOMÁTICA DE LENGUAJES PRESENTES EN EL TEXTO
           ============================================================ */
        function extractBlocks(fullCode, regex) {
            const blocks = [];
            let m;
            while ((m = regex.exec(fullCode)) !== null) blocks.push(m[1] !== undefined ? m[1] : m[0]);
            return blocks;
        }
        function detectAndAnalyze(code, mode) {
            const sections = [];
            if (mode !== 'auto') {
                switch (mode) {
                    case 'html': sections.push({ key: 'html', label: '🌐 HTML', kind: 'html', result: new HTMLTagValidator().analyze(code) }); break;
                    case 'css': sections.push({ key: 'css', label: '🎨 CSS3', kind: 'brackets', result: analyzeCSS(code) }); break;
                    case 'js': sections.push({ key: 'js', label: '⚙️ JavaScript', kind: 'brackets', result: analyzeJS(code) }); break;
                    case 'php': sections.push({ key: 'php', label: '🐘 PHP', kind: 'brackets', result: analyzePHP(code) }); break;
                    case 'sql': sections.push({ key: 'sql', label: '🗄️ SQL', kind: 'brackets', result: analyzeSQL(code) }); break;
                }
                return sections;
            }
            // AUTO: detectar qué hay presente
            const hasPHP = /<\?php|<\?=/i.test(code);
            const styleBlocks = extractBlocks(code, /<style[^>]*>([\s\S]*?)<\/style>/gi);
            const scriptBlocks = extractBlocks(code, reScriptOpenClose());
            const hasHtmlTags = /<\s*[a-zA-Z][a-zA-Z0-9]*[^>]*>/.test(code.replace(/<\?php[\s\S]*?\?>/g, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(reScriptBlock(), ''));
            const looksLikeSQL = !/<\w/.test(code) && /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i.test(code);
            const looksLikeCSSOnly = !/<\w/.test(code) && !hasPHP && /[.#]?[\w-]+\s*\{[\s\S]*?:[\s\S]*?;?[\s\S]*?\}/.test(code) && !/\b(function|const|let|var|=>)\b/.test(code);
            const looksLikeJSOnly = !/<\w/.test(code) && !hasPHP && !looksLikeSQL && !looksLikeCSSOnly && /\b(function|const|let|var|=>|console\.)\b/.test(code);
            if (hasPHP) sections.push({ key: 'php', label: '🐘 PHP', kind: 'brackets', result: analyzePHP(code) });
            if (styleBlocks.length > 0) {
                const combined = styleBlocks.join('\n');
                sections.push({ key: 'css', label: `🎨 CSS3 (${styleBlocks.length} bloque${styleBlocks.length > 1 ? 's' : ''} <style>)`, kind: 'brackets', result: analyzeCSS(combined) });
            }
            if (scriptBlocks.length > 0) {
                const combined = scriptBlocks.join('\n');
                sections.push({ key: 'js', label: `⚙️ JavaScript (${scriptBlocks.length} bloque${scriptBlocks.length > 1 ? 's' : ''} de script)`, kind: 'brackets', result: analyzeJS(combined) });
            }
            if (hasHtmlTags) {
                sections.push({ key: 'html', label: '🌐 HTML', kind: 'html', result: new HTMLTagValidator().analyze(code) });
            }
            if (looksLikeSQL) sections.push({ key: 'sql', label: '🗄️ SQL', kind: 'brackets', result: analyzeSQL(code) });
            if (looksLikeCSSOnly) sections.push({ key: 'css', label: '🎨 CSS3', kind: 'brackets', result: analyzeCSS(code) });
            if (looksLikeJSOnly) sections.push({ key: 'js', label: '⚙️ JavaScript', kind: 'brackets', result: analyzeJS(code) });
            if (sections.length === 0) {
                // fallback: al menos revisar balance genérico de símbolos
                sections.push({ key: 'generic', label: '🔣 Balance de símbolos ( ) [ ] { }', kind: 'brackets', result: analyzeBrackets(code, { lineComments: ['//', '--'], blockComments: [['/*', '*/']] }) });
            }
            return sections;
        }
        /* ============================================================
           MINIFICADOR (HTML / CSS / JavaScript / SQL)
           ============================================================ */
        function stripJSComments(code) {
            let out = '';
            let i = 0;
            const n = code.length;
            let inString = null;
            let inLineComment = false;
            let inBlockComment = false;
            while (i < n) {
                const ch = code[i];
                if (inLineComment) { if (ch === '\n') { inLineComment = false; out += ch; } i++; continue; }
                if (inBlockComment) {
                    if (ch === '*' && code[i + 1] === '/') { inBlockComment = false; i += 2; continue; }
                    i++; continue;
                }
                if (inString) {
                    out += ch;
                    if (ch === '\\') { out += code[i + 1] || ''; i += 2; continue; }
                    if (ch === inString) inString = null;
                    i++; continue;
                }
                if (ch === '/' && code[i + 1] === '/') { inLineComment = true; i += 2; continue; }
                if (ch === '/' && code[i + 1] === '*') { inBlockComment = true; i += 2; continue; }
                if (ch === '"' || ch === "'" || ch === '`') { inString = ch; out += ch; i++; continue; }
                out += ch; i++;
            }
            return out;
        }
        function minifyJS(code) {
            const stripped = stripJSComments(code);
            let out = '';
            let inString = null;
            let lastChar = '';
            for (let i = 0; i < stripped.length; i++) {
                const ch = stripped[i];
                if (inString) {
                    out += ch;
                    if (ch === '\\') { out += stripped[++i] || ''; continue; }
                    if (ch === inString) inString = null;
                    lastChar = ch;
                    continue;
                }
                if (ch === '"' || ch === "'" || ch === '`') { inString = ch; out += ch; lastChar = ch; continue; }
                if (/\s/.test(ch)) {
                    let j = i;
                    while (j < stripped.length && /\s/.test(stripped[j])) j++;
                    const nextCh = stripped[j] || '';
                    if (/[\w$]/.test(lastChar) && /[\w$]/.test(nextCh)) out += ' ';
                    i = j - 1;
                    continue;
                }
                out += ch;
                lastChar = ch;
            }
            return out.trim();
        }
        function minifyCSS(code) {
            const strings = [];
            let out = code.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, m => {
                strings.push(m);
                return ` ${strings.length - 1} `;
            });
            out = out.replace(/\/\*[\s\S]*?\*\//g, '');
            out = out.replace(/\s*([{}:;,>~])\s*/g, '$1');
            out = out.replace(/;}/g, '}');
            out = out.replace(/\s+/g, ' ').trim();
            return out.replace(/ (\d+) /g, (_, idx) => strings[+idx]);
        }
        function minifySQL(code) {
            return code
                .replace(/--.*$/gm, '')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/\s+/g, ' ')
                .trim();
        }
        function minifyHTML(code) {
            const preserved = [];
            let out = code.replace(/<(script|style|textarea|pre)\b[^>]*>[\s\S]*?<\/\1>/gi, m => {
                preserved.push(m);
                return ` ${preserved.length - 1} `;
            });
            out = out.replace(/<!--[\s\S]*?-->/g, '');
            out = out.replace(/>\s+</g, '><');
            out = out.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '');
            out = out.trim();
            return out.replace(/ (\d+) /g, (_, idx) => {
                const block = preserved[+idx];
                const tagMatch = block.match(/^<(script|style|textarea|pre)\b([^>]*)>/i);
                const tag = tagMatch[1].toLowerCase();
                const openTag = block.slice(0, tagMatch[0].length);
                const closeTag = `</${tag}>`;
                let inner = block.slice(tagMatch[0].length, block.length - closeTag.length);
                if (tag === 'script' && !/\bsrc\s*=/i.test(tagMatch[2])) inner = minifyJS(inner);
                else if (tag === 'style') inner = minifyCSS(inner);
                return openTag + inner + closeTag;
            });
        }
        function minifyAuto(code) {
            const hasHtmlTags = /<\s*[a-zA-Z][a-zA-Z0-9]*[^>]*>/.test(code);
            const looksLikeSQL = !/<\w/.test(code) && /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i.test(code);
            const looksLikeCSSOnly = !/<\w/.test(code) && !looksLikeSQL && /[.#]?[\w-]+\s*\{[\s\S]*?:[\s\S]*?;?[\s\S]*?\}/.test(code) && !/\b(function|const|let|var|=>)\b/.test(code);
            if (hasHtmlTags) return minifyHTML(code);
            if (looksLikeCSSOnly) return minifyCSS(code);
            if (looksLikeSQL) return minifySQL(code);
            return minifyJS(code);
        }
        /* ============================================================
           UI
           ============================================================ */
        document.addEventListener('DOMContentLoaded', function () {
            const fileInput = document.getElementById('fileInput');
            const codeContent = document.getElementById('codeContent');
            const analyzeBtn = document.getElementById('analyzeBtn');
            const clearBtn = document.getElementById('clearBtn');
            const results = document.getElementById('results');
            const loading = document.getElementById('loading');
            const fileName = document.getElementById('fileName');
            const modeGrid = document.getElementById('modeGrid');
            const minifyBtn = document.getElementById('minifyBtn');
            const minifyResults = document.getElementById('minifyResults');
            const minifyStats = document.getElementById('minifyStats');
            const minifiedOutput = document.getElementById('minifiedOutput');
            const copyMinBtn = document.getElementById('copyMinBtn');
            const downloadMinBtn = document.getElementById('downloadMinBtn');
            let currentMode = 'auto';
            modeGrid.addEventListener('click', function (e) {
                const opt = e.target.closest('.mode-option');
                if (!opt) return;
                document.querySelectorAll('.mode-option').forEach(o => o.classList.remove('active'));
                opt.classList.add('active');
                currentMode = opt.dataset.mode;
            });
            fileInput.addEventListener('change', function (e) {
                const file = e.target.files[0];
                if (file) {
                    fileName.textContent = `📄 ${file.name}`;
                    const reader = new FileReader();
                    reader.onload = function (e) { codeContent.value = e.target.result; };
                    reader.readAsText(file);
                    // auto-seleccionar modo según extensión, si no es auto forzado por el usuario
                    const ext = file.name.split('.').pop().toLowerCase();
                    const extMap = { php: 'php', css: 'css', js: 'js', sql: 'sql', html: 'html', htm: 'html' };
                    if (extMap[ext]) {
                        document.querySelectorAll('.mode-option').forEach(o => o.classList.remove('active'));
                        const target = document.querySelector(`.mode-option[data-mode="${extMap[ext]}"]`);
                        if (target) { target.classList.add('active'); currentMode = extMap[ext]; }
                    }
                }
            });
            analyzeBtn.addEventListener('click', function () {
                const content = codeContent.value.trim();
                if (!content) { alert('Por favor, introduce o carga código para analizar.'); return; }
                showLoading(true);
                setTimeout(() => {
                    const sections = detectAndAnalyze(content, currentMode);
                    displayResults(sections);
                    showLoading(false);
                }, 600);
            });
            minifyBtn.addEventListener('click', function () {
                const content = codeContent.value;
                if (!content.trim()) { alert('Por favor, introduce o carga código para minificar.'); return; }
                const minified = minifyAuto(content);
                const originalSize = new Blob([content]).size;
                const minifiedSize = new Blob([minified]).size;
                const savings = originalSize > 0 ? (100 - (minifiedSize / originalSize) * 100) : 0;
                minifyStats.innerHTML = `
                    <span>Tamaño original: <span class="highlight">${originalSize.toLocaleString()} B</span></span>
                    <span>Tamaño minificado: <span class="highlight">${minifiedSize.toLocaleString()} B</span></span>
                    <span>Ahorro: <span class="highlight">${savings.toFixed(1)}%</span></span>
                `;
                minifiedOutput.value = minified;
                minifyResults.style.display = 'block';
            });
            copyMinBtn.addEventListener('click', function () {
                minifiedOutput.select();
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(minifiedOutput.value).then(() => {
                        const original = copyMinBtn.textContent;
                        copyMinBtn.textContent = '✅ Copiado';
                        setTimeout(() => { copyMinBtn.textContent = original; }, 1500);
                    }).catch(() => document.execCommand('copy'));
                } else {
                    document.execCommand('copy');
                }
            });
            downloadMinBtn.addEventListener('click', function () {
                const blob = new Blob([minifiedOutput.value], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'minificado.txt';
                a.click();
                URL.revokeObjectURL(url);
            });
            clearBtn.addEventListener('click', function () {
                codeContent.value = '';
                fileInput.value = '';
                fileName.textContent = '';
                results.style.display = 'none';
                minifyResults.style.display = 'none';
                minifiedOutput.value = '';
            });
            function showLoading(show) {
                loading.style.display = show ? 'block' : 'none';
                results.style.display = show ? 'none' : 'block';
            }
            function sectionIsValid(sec) {
                if (sec.kind === 'html') return sec.result.isValid;
                return sec.result.errors.length === 0;
            }
            function sectionHasWarnings(sec) {
                if (sec.kind === 'html') return false;
                return sec.result.warnings && sec.result.warnings.length > 0;
            }
            function displayResults(sections) {
                const allValid = sections.every(sectionIsValid);
                const anyWarnings = sections.some(sectionHasWarnings);
                const statusDiv = document.getElementById('overallStatus');
                let statusClass = 'status-success';
                let statusTitle = '✅ TODO EL CÓDIGO ES VÁLIDO';
                let statusMsg = 'No se encontraron errores de balance ni estructura en ninguno de los lenguajes analizados.';
                if (!allValid) {
                    statusClass = 'status-error';
                    statusTitle = '❌ SE ENCONTRARON ERRORES';
                    const totalErrors = sections.reduce((sum, s) => sum + s.result.errors.length, 0);
                    statusMsg = `Se encontraron ${totalErrors} error(es) en total. Revisa el detalle por lenguaje abajo.`;
                } else if (anyWarnings) {
                    statusClass = 'status-warning';
                    statusTitle = '⚠️ VÁLIDO CON ADVERTENCIAS';
                    statusMsg = 'No hay errores de balance, pero revisa las advertencias señaladas abajo.';
                }
                statusDiv.className = `status-card ${statusClass}`;
                statusDiv.innerHTML = `<div style="font-size:1.25em;">${statusTitle}</div><div style="margin-top:8px; font-weight:normal;">${statusMsg}</div>`;
                // Stats resumen
                const statsDiv = document.getElementById('statsSummary');
                const totalErrors = sections.reduce((sum, s) => sum + s.result.errors.length, 0);
                const totalWarnings = sections.reduce((sum, s) => sum + (s.result.warnings ? s.result.warnings.length : 0), 0);
                statsDiv.innerHTML = `
                    <div class="stat-item">
                        <span class="stat-number">${sections.length}</span>
                        <div class="stat-label">Lenguajes analizados</div>
                    </div>
                    <div class="stat-item">
                        <span class="stat-number" style="color:#dc3545;">${totalErrors}</span>
                        <div class="stat-label">Errores totales</div>
                    </div>
                    <div class="stat-item">
                        <span class="stat-number" style="color:#e0a800;">${totalWarnings}</span>
                        <div class="stat-label">Advertencias</div>
                    </div>
                `;
                // Secciones por lenguaje
                const container = document.getElementById('languageSections');
                container.innerHTML = sections.map(sec => renderSection(sec)).join('');
                results.style.display = 'block';
            }
            function renderSection(sec) {
                const valid = sectionIsValid(sec);
                const hasWarn = sectionHasWarnings(sec);
                const headerClass = !valid ? 'bad' : (hasWarn ? 'warn' : 'ok');
                const headerIcon = !valid ? '❌' : (hasWarn ? '⚠️' : '✅');
                let body = '';
                if (sec.kind === 'html') {
                    body += renderHTMLBody(sec.result);
                } else {
                    body += renderBracketBody(sec.result, sec.key);
                }
                return `
                    <div class="lang-section">
                        <div class="lang-header ${headerClass}">${headerIcon} ${sec.label}</div>
                        <div class="lang-body">${body}</div>
                    </div>
                `;
            }
            function renderHTMLBody(r) {
                const tagCards = Object.entries(r.tagCounts)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([tagName, counts]) => {
                        const isVoid = new HTMLTagValidator().voidElements.includes(tagName);
                        const isBalanced = isVoid || counts.opening === counts.closing;
                        let statusText = isVoid
                            ? `${counts.opening + counts.selfClosing} elementos (auto-cerradas)`
                            : `${counts.opening} aperturas, ${counts.closing} cierres`;
                        return `
                            <div class="tag-card">
                                <div class="tag-name">&lt;${tagName}&gt;</div>
                                <div class="tag-count ${isBalanced ? 'balanced' : 'unbalanced'}">${statusText} ${isBalanced ? '✓' : '❌'}</div>
                            </div>`;
                    }).join('');
                const errorsHtml = r.errors.length > 0
                    ? `<ul class="error-list">${r.errors.map(e => `<li class="error-item"><strong>${e.message}</strong>${e.line ? `<div class="line-info">Línea: ${e.line}</div>` : ''}</li>`).join('')}</ul>`
                    : `<p class="empty-lang-note">Sin errores de etiquetas.</p>`;
                return `
                    <div class="tags-grid">${tagCards || '<p class="empty-lang-note">No se detectaron etiquetas HTML.</p>'}</div>
                    <div class="details-section">
                        <h3 style="margin-bottom:10px; color:${r.errors.length ? '#dc3545' : '#28a745'};">Errores (${r.errors.length})</h3>
                        ${errorsHtml}
                    </div>
                `;
            }
            function renderBracketBody(r, key) {
                const errorsHtml = r.errors.length > 0
                    ? `<ul class="error-list">${r.errors.map(e => `<li class="error-item"><strong>${e.message}</strong>${e.line ? `<div class="line-info">Línea: ${e.line}</div>` : ''}</li>`).join('')}</ul>`
                    : `<p class="empty-lang-note">✓ Todos los paréntesis <code>()</code>, corchetes <code>[]</code> y llaves <code>{}</code> están balanceados${key === 'php' ? ', y los bloques &lt;?php ... ?&gt; están correctamente cerrados' : ''}.</p>`;
                const warningsHtml = (r.warnings && r.warnings.length > 0)
                    ? `<ul class="warning-list">${r.warnings.map(w => `<li class="warning-item"><strong>${w.message}</strong>${w.line ? `<div class="line-info">Línea: ${w.line}</div>` : ''}</li>`).join('')}</ul>`
                    : '';
                return `
                    <div class="details-section">
                        <h3 style="margin-bottom:10px; color:${r.errors.length ? '#dc3545' : '#28a745'};">Errores (${r.errors.length})</h3>
                        ${errorsHtml}
                        ${warningsHtml ? `<h3 style="margin:16px 0 10px; color:#e0a800;">Advertencias (${r.warnings.length})</h3>${warningsHtml}` : ''}
                    </div>
                `;
            }
        });
    