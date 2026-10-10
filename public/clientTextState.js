/* ClientText facts and proof contracts, shared by the browser, workers and API. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ClientTextState = api;
})(typeof globalThis === 'object' ? globalThis : self, function () {
    'use strict';
    const FORMAT = 'clienttext-v1', PARSER_VERSION = 'clienttext-v1';
    const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
    const copy = value => value === undefined || value === null || typeof value === 'string' || typeof value === 'boolean' ? value : JSON.parse(JSON.stringify(value));
    function canonical(value) {
        if (Array.isArray(value)) return value.map(canonical);
        if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
            .filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
        if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Non-finite ClientText number.');
        return value;
    }
    const stableStringify = value => JSON.stringify(canonical(value));
    // Synchronous SHA-256 makes small per-field proofs usable in UI status and
    // avoids hundreds of thousands of WebCrypto promise callbacks during import.
    const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const hashEncoder = new TextEncoder(), hashWords = new Uint32Array(64), hashScratch = new Uint8Array(16384);
    const rotr = (n, b) => (n >>> b) | (n << (32 - b));
    function sha256(bytes) {
        if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
        const length = bytes.length, paddedLength = Math.ceil((length + 9) / 64) * 64;
        const padded = paddedLength <= hashScratch.length ? hashScratch.subarray(0, paddedLength) : new Uint8Array(paddedLength);
        padded.fill(0);
        padded.set(bytes); padded[length] = 0x80;
        const view = new DataView(padded.buffer, padded.byteOffset, padded.length), bits = length * 8;
        view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000)); view.setUint32(padded.length - 4, bits >>> 0);
        let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
        const w = hashWords;
        for (let start = 0; start < padded.length; start += 64) {
            for (let i = 0; i < 16; i++) w[i] = view.getUint32(start + i * 4);
            for (let i = 16; i < 64; i++) {
                const a = w[i - 15], b = w[i - 2];
                w[i] = (w[i - 16] + (rotr(a,7) ^ rotr(a,18) ^ (a >>> 3)) + w[i - 7] + (rotr(b,17) ^ rotr(b,19) ^ (b >>> 10))) >>> 0;
            }
            let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,j=h7;
            for (let i = 0; i < 64; i++) {
                const t1 = (j + (rotr(e,6) ^ rotr(e,11) ^ rotr(e,25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
                const t2 = ((rotr(a,2) ^ rotr(a,13) ^ rotr(a,22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
                j=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
            }
            h0=(h0+a)>>>0;h1=(h1+b)>>>0;h2=(h2+c)>>>0;h3=(h3+d)>>>0;
            h4=(h4+e)>>>0;h5=(h5+f)>>>0;h6=(h6+g)>>>0;h7=(h7+j)>>>0;
        }
        return [h0,h1,h2,h3,h4,h5,h6,h7].map(value => value.toString(16).padStart(8, '0')).join('');
    }
    // Repeated source/form/empty-target strings occur within and across rows.
    // Keep a bounded cache of immutable scalars; mutable witnesses are always
    // hashed again, so edits cannot reuse an old unit hash.
    const scalarHashes = new Map(), MAX_SCALAR_HASHES = 8192, MAX_SCALAR_CHARACTERS = 2 * 1024 * 1024;
    let scalarCharacters = 0;
    function hash(value) {
        const cacheable = typeof value === 'string' && value.length <= 8192;
        if (cacheable && scalarHashes.has(value)) return scalarHashes.get(value);
        const digest = sha256(hashEncoder.encode(stableStringify(value)));
        if (cacheable) {
            while (scalarHashes.size >= MAX_SCALAR_HASHES || scalarCharacters + value.length > MAX_SCALAR_CHARACTERS) {
                const oldest = scalarHashes.keys().next().value;
                scalarCharacters -= oldest.length; scalarHashes.delete(oldest);
            }
            scalarHashes.set(value, digest); scalarCharacters += value.length;
        }
        return digest;
    }
    function canonicalSource(value) {
        const text = String(value ?? '');
        const marker = text.indexOf('[NOAUDIO]');
        return marker >= 0 && text.indexOf('[NOAUDIO]', marker + 9) < 0 ? text.replace(/^ ?\[NOAUDIO\](?: |$)/, '') : text;
    }
    const audioOnly = source => /^ ?\[NOAUDIO\] ?$/.test(String(source ?? ''));
    const sourceHash = source => hash(canonicalSource(source));
    function normalizeUnit(input) {
        if (!input || typeof input !== 'object') throw new TypeError('Invalid ClientText unit.');
        const role = String(input.role || 'normal'), sheet = String(input.sheet ?? ''), recordId = String(input.recordId ?? '');
        const id = JSON.stringify([role, sheet, recordId]);
        if (!sheet || !recordId || (input.id && input.id !== id)) throw new TypeError('Invalid ClientText unit identity.');
        if (!Array.isArray(input.fields) || !input.fields.length) throw new TypeError('ClientText unit has no fields.');
        const used = new Set();
        const fields = input.fields.map(field => {
            if (!field || typeof field.id !== 'string' || !field.id || used.has(field.id)) throw new TypeError('Duplicate or missing ClientText field ID.');
            used.add(field.id);
            if (!['text', 'form', 'gender'].includes(field.kind)) throw new TypeError('Unknown ClientText field kind.');
            const value = { id: field.id, name: String(field.name ?? ''), kind: field.kind,
                source: String(field.source ?? ''), target: String(field.target ?? ''), required: !!field.required,
                originalMissing: !!field.originalMissing, outdated: !!field.outdated,
                sourceCell: String(field.sourceCell ?? ''), targetCell: String(field.targetCell ?? ''),
                originalFill: copy(field.originalFill ?? null), originalStyleId: field.originalStyleId ?? null };
            if (own(field, 'form')) value.form = copy(field.form);
            if (own(field, 'group')) value.group = copy(field.group);
            return value;
        });
        return { id, role, sheet, recordId, fields, developerNotes: String(input.developerNotes ?? ''), metadata: copy(input.metadata || {}) };
    }
    function compactUnit(input) {
        const unit = normalizeUnit(input);
        return { id: unit.id, role: unit.role, sheet: unit.sheet, recordId: unit.recordId, hash: hash(unit), fields: unit.fields.map(field => { const markerOnly = audioOnly(field.source); return ({
            id: field.id, kind: field.kind, sourceHash: sourceHash(field.source), originalHash: hash(field.target),
            required: field.required && !markerOnly, originalMissing: field.originalMissing && !markerOnly,
            outdated: field.outdated && !markerOnly, audioOnly: markerOnly }); }) };
    }
    const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    function normalizeCompact(input) {
        if (!input || !hex(input.hash) || !Array.isArray(input.fields) || !input.fields.length) throw new TypeError('Invalid compact ClientText unit.');
        if (input.id !== JSON.stringify([input.role, input.sheet, input.recordId])) throw new TypeError('Invalid compact ClientText identity.');
        const used = new Set();
        const fields = input.fields.map(field => {
            if (!field || typeof field.id !== 'string' || !field.id || used.has(field.id) || !hex(field.sourceHash) || !hex(field.originalHash)
                || !['text','form','gender'].includes(field.kind)) throw new TypeError('Invalid compact ClientText field.');
            used.add(field.id);
            return { id: field.id, kind: field.kind, sourceHash: field.sourceHash, originalHash: field.originalHash,
                required: !!field.required, originalMissing: !!field.originalMissing, outdated: !!field.outdated, audioOnly: !!field.audioOnly };
        });
        return { id: input.id, role: input.role, sheet: input.sheet, recordId: input.recordId, hash: input.hash, fields };
    }
    const leafHash = (id, unitHash) => hash(['unit', id, unitHash]);
    const nodeHash = (left, right) => hash(['node', left, right]);
    async function buildManifest(inputs, assets = [], options = {}) {
        const units = [], byRole = new Map(), used = new Set();
        const pause = options.yield || (() => new Promise(resolve => setTimeout(resolve, 0)));
        for (let index = 0; index < inputs.length; index++) {
            if (options.guard && !options.guard()) throw Object.assign(new Error('ClientText import context changed.'), { stale: true });
            const compact = compactUnit(inputs[index]);
            if (used.has(compact.id)) throw new TypeError('Duplicate ClientText unit: ' + compact.id);
            used.add(compact.id); units.push(compact);
            if (!byRole.has(compact.role)) byRole.set(compact.role, []);
            byRole.get(compact.role).push(compact);
            if (index % 256 === 255) { options.onProgress?.({ phase: 'manifest', processed: index + 1, total: inputs.length, sheet: compact.sheet }); await pause(); }
        }
        const descriptors = [], trees = {};
        for (const [role, roleUnits] of byRole) {
            roleUnits.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
            const levels = [roleUnits.map(unit => leafHash(unit.id, unit.hash))];
            while (levels[levels.length - 1].length > 1) {
                const previous = levels[levels.length - 1], next = [];
                for (let i = 0; i < previous.length; i += 2) {
                    next.push(nodeHash(previous[i], previous[i + 1] || previous[i]));
                    if (i % 512 === 510) { if (options.guard && !options.guard()) throw Object.assign(new Error('ClientText import context changed.'), { stale: true }); await pause(); }
                }
                levels.push(next);
            }
            const asset = Array.isArray(assets) ? assets.find(value => value.role === role) : assets[role];
            const assetHash = asset?.hash || asset?.assetHash || '';
            if (!hex(assetHash)) throw new TypeError('Missing ClientText original asset SHA-256 for ' + role + '.');
            const descriptor = { format: FORMAT, role, assetHash, parserVersion: PARSER_VERSION,
                root: levels[levels.length - 1][0], unitCount: roleUnits.length };
            if (asset.schemaHash) descriptor.schemaHash = asset.schemaHash;
            descriptor.baselineId = hash(descriptor);
            descriptors.push(descriptor); trees[role] = { ids: roleUnits.map(unit => unit.id), levels };
        }
        return { format: FORMAT, units, descriptors, trees };
    }
    function proofFor(manifest, unitId) {
        const role = JSON.parse(unitId)[0], tree = manifest.trees?.[role];
        if (!tree) throw new Error('ClientText proof tree is unavailable.');
        let low = 0, high = tree.ids.length;
        while (low < high) { const middle = (low + high) >>> 1; if (tree.ids[middle] < unitId) low = middle + 1; else high = middle; }
        if (tree.ids[low] !== unitId) throw new Error('ClientText unit is absent from the original.');
        const index = low, siblings = [];
        for (let level = 0; level < tree.levels.length - 1; level++) {
            const values = tree.levels[level], sibling = low % 2 ? low - 1 : Math.min(low + 1, values.length - 1);
            siblings.push({ side: low % 2 ? 'left' : 'right', hash: values[sibling] }); low = Math.floor(low / 2);
        }
        return { index, siblings };
    }
    function verifyWitness(input, compactInput, proof, descriptor) {
        try {
            const compact = normalizeCompact(compactInput);
            if (stableStringify(compactUnit(input)) !== stableStringify(compact)) return false;
            if (!descriptor || descriptor.format !== FORMAT || descriptor.role !== compact.role || !hex(descriptor.root)
                || !Number.isSafeInteger(descriptor.unitCount) || descriptor.unitCount < 1 || !proof
                || !Number.isSafeInteger(proof.index) || proof.index < 0 || proof.index >= descriptor.unitCount || !Array.isArray(proof.siblings)) return false;
            let current = leafHash(compact.id, compact.hash), index = proof.index, count = descriptor.unitCount, depth = 0;
            while (count > 1) {
                const sibling = proof.siblings[depth++], expected = index % 2 ? 'left' : 'right';
                if (!sibling || sibling.side !== expected || !hex(sibling.hash)) return false;
                if (index % 2 === 0 && index + 1 === count && sibling.hash !== current) return false;
                current = expected === 'left' ? nodeHash(sibling.hash, current) : nodeHash(current, sibling.hash);
                index = Math.floor(index / 2); count = Math.ceil(count / 2);
            }
            return depth === proof.siblings.length && current === descriptor.root;
        } catch (_) { return false; }
    }
    function normalizeValues(unit, input, options = {}) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('ClientText values must be keyed by field ID.');
        const ids = new Set(unit.fields.map(field => field.id));
        for (const id of Object.keys(input)) if (!ids.has(id) || typeof input[id] !== 'string') throw new TypeError('Unknown or non-text ClientText field.');
        if (options.complete !== false && Object.keys(input).length !== ids.size) throw new TypeError('ClientText save must contain every field.');
        return Object.fromEntries(unit.fields.filter(field => own(input, field.id)).map(field => [field.id, input[field.id]]));
    }
    function normalizeReviewed(unit, input = {}) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('ClientText reviews must identify current source hashes.');
        const fields = new Map(unit.fields.map(field => [field.id, field]));
        for (const [id, value] of Object.entries(input)) {
            const field = fields.get(id), current = field && (field.sourceHash || sourceHash(field.source));
            if (!field || value !== current) throw new TypeError('ClientText review does not match the current field source.');
        }
        return copy(input);
    }
    function valuesFor(unit, saved = null) {
        return Object.fromEntries(unit.fields.map(field => [field.id, own(saved?.values, field.id) ? saved.values[field.id] : field.target]));
    }
    const isAbsent = (field, value) => !!field.required && !audioOnly(field.source) && !String(value ?? '').trim();
    function statusFor(unit, saved = null) {
        const values = valuesFor(unit, saved), reviewed = saved?.reviewed || {}, fields = {}, savedPresent = !!saved && saved.saved !== false;
        for (const field of unit.fields) {
            const originalMissing = isAbsent(field,field.target) || !!field.originalMissing;
            const assignedOutdated = (!!field.outdated || (saved?.outdated || []).includes(field.id)) && !audioOnly(field.source);
            const missing = isAbsent(field,values[field.id]), outdated = assignedOutdated && reviewed[field.id] !== sourceHash(field.source);
            fields[field.id] = { missing,outdated,saved:savedPresent,
                revised:savedPresent && !originalMissing && !assignedOutdated && !audioOnly(field.source) && values[field.id] !== field.target,
                unchanged:!missing && !outdated && !savedPresent };
        }
        const missing = Object.values(fields).some(field => field.missing), outdated = Object.values(fields).some(field => field.outdated);
        const revised = Object.values(fields).some(field => field.revised);
        return { missing, outdated, saved: savedPresent, revised, unchanged: !missing && !outdated && !savedPresent,
            isMissing: missing, isOutdated: outdated, hasChanges: savedPresent, isRevised: revised, isDropped: false, fields };
    }
    function counts(units, saved = {}) {
        const value = { missing: 0, outdated: 0, saved: 0, revised: 0, unchanged: 0, total: units.length };
        for (const unit of units) for (const key of ['missing','outdated','saved','revised','unchanged']) if (statusFor(unit, saved instanceof Map ? saved.get(unit.id) : saved[unit.id])[key]) value[key]++;
        return value;
    }
    function carryForward(previousUnit, nextUnit, previousSaved) {
        const before = new Map(previousUnit.fields.map(field => [field.id, field]));
        const previous = valuesFor(previousUnit, previousSaved), values = valuesFor(nextUnit), reviewed = {}, conflicts = [], removed = [];
        for (const field of nextUnit.fields) {
            const old = before.get(field.id); if (!old) continue;
            const authored = previous[field.id], oldBase = old.target, newBase = field.target;
            const localChanged = authored !== oldBase, upstreamChanged = newBase !== oldBase;
            if (localChanged && upstreamChanged && authored !== newBase) {
                conflicts.push({ fieldId: field.id, base: oldBase, local: authored, upstream: newBase }); values[field.id] = newBase;
            } else values[field.id] = localChanged ? authored : newBase;
            const sourceChanged = canonicalSource(old.source) !== canonicalSource(field.source);
            if (!sourceChanged && previousSaved?.reviewed?.[field.id] === sourceHash(old.source)) reviewed[field.id] = sourceHash(field.source);
        }
        for (const field of previousUnit.fields) if (!nextUnit.fields.some(next => next.id === field.id)) removed.push({ field: copy(field), value: previous[field.id] });
        const outdated = nextUnit.fields.filter(field => before.has(field.id) && !audioOnly(field.source)
            && canonicalSource(before.get(field.id).source) !== canonicalSource(field.source)).map(field => field.id);
        return { values, reviewed, outdated, conflicts, removed, saved: !!previousSaved && previousSaved.saved !== false, dropped: [] };
    }
    // This is SD's variable grammar plus the numeric format extension already
    // accepted by ClientText (for example {2:0.1f}). Braces around localizable
    // formatting text, such as {Fire Rune}, are not variable placeholders.
    const VARIABLE_AT_START = /^([@+\-]?)\{([\dd:+]*|\d+:[^{}\r\n]+)\}(%?)/i;
    const KEYWORD_AT_START = /^\[([^\]|]+)(?:\|([^\]]*))?\]/;
    function variableIdentityKey(value) {
        const full = String(value ?? ''), match = /^[@+\-]?\{([^}]*)\}%?$/.exec(full);
        return match ? match[1] : full;
    }
    function tokenize(value) {
        const text = String(value ?? ''), tokens = [];
        const formats = new Set(['size','font','rgb','glow','fg','colour','color','smaller','b','i','n','normal','italic','bold','u',
            'shadow','center','left','right','red','green','blue','white','yellow','default','light',
            'unique','magic','rare','gem','currency','enchanted']);
        const add = (full,start,kind,identity=full) => tokens.push({full,start,end:start+full.length,kind,identity});
        for (let index=0;index<text.length;index++) {
            if ('{@+-'.includes(text[index])) {
                const match = VARIABLE_AT_START.exec(text.slice(index));
                if (match) {
                    const full=match[0], prefix=match[1], key=match[2], trailingPercent=!!match[3];
                    tokens.push({full,start:index,end:index+full.length,kind:'variable',
                        identity:'{'+key+'}'+(trailingPercent?'%':''),key,prefix,trailingPercent});
                    index+=full.length-1;continue;
                }
            }
            if (text.startsWith('<<',index)) {
                const end=text.indexOf('>>',index+2);
                if(end<0)continue;
                add(text.slice(index,end+2),index,'substitution');index=end+1;continue;
            }
            if(text[index]==='['){
                const match=KEYWORD_AT_START.exec(text.slice(index));
                if(!match)continue;
                const full=match[0],identity=match[1];
                add(full,index,full==='[NOAUDIO]'?'audio':'keyword',identity);
                // Numeric references in keyword identities are part of the ID;
                // numeric placeholders in visible link text remain variables.
                const separator=full.indexOf('|');
                if(separator>=0){const visible=full.slice(separator+1,-1);for(const token of tokenize(visible))tokens.push({...token,start:token.start+index+separator+1,end:token.end+index+separator+1});}
                index+=full.length-1;continue;
            }
            if(text[index]==='<'){
                const match=/^<[^<>\r\n]+>/.exec(text.slice(index));
                if(!match)continue;
                const full=match[0],body=full.slice(1,-1),name=/^\/?([A-Za-z]+)(?=[:(]|$)/.exec(body)?.[1]?.toLowerCase();
                const kind=name==='continue'?'control':formats.has(name)?'format':'stage-direction';
                add(full,index,kind);index+=full.length-1;
            }
        }
        return tokens;
    }
    /** Raw UTF-16 offsets, including prefixes and %, suitable for preview and insertion. */
    function extractVariables(value) {
        return tokenize(value).filter(token => token.kind === 'variable');
    }
    function diagnose(field, value, options = {}) {
        const text = String(value ?? ''), result = [];
        if (field.kind === 'gender') return result;
        if (field.kind === 'form' && text.trim() === 'NONEXISTENT') return result;
        if (audioOnly(field.source)) return result;
        const add = (level, code, message, start = 0, end = Math.max(1, text.length)) => result.push({ level, code, message, start, end });
        const source = tokenize(canonicalSource(field.source)), target = tokenize(text);
        if (options.tagSyntax !== false) {
            for(const token of [...source,...target].filter(token=>token.kind==='stage-direction'))if(!result.some(issue=>issue.code==='clienttext-unknown-syntax' && issue.token===token.full))result.push({level:'warning',code:'clienttext-unknown-syntax',token:token.full,message:'Unrecognized ClientText syntax '+token.full+'. Verify the upstream control or formatting rule; this text is preserved.',start:token.start,end:token.end});
            for (const token of target.filter(token => token.kind === 'keyword')) {
                // Keep the same narrow nested-brace exceptions as SD. These
                // braces belong to the immutable reference, never a variable.
                const identity=token.identity, brace=identity.search(/[{}]/);
                if(brace>=0 && !/^[A-Za-z][A-Za-z0-9_]*::\{\d+\}$/.test(identity)
                    && !/^[A-Za-z][A-Za-z0-9_]*<gemlevel=\{\d+\}>$/.test(identity))
                    add('error','nested-tags','Braces in a keyword ID must be a numeric ::{n} or <gemlevel={n}> reference.',token.start+1+brace,token.start+1+identity.length);
                const nested=identity.indexOf('[');
                if(nested>=0)add('error','nested-tags','Close the keyword tag before starting another keyword tag.',token.start+1+nested,token.end);
            }
            for (const [open, close] of [['[',']'],['{','}']]) {
                const stack = [];
                for (let i = 0; i < text.length; i++) {
                    if (text[i] === open) stack.push(i);
                    else if (text[i] === close && !stack.length) add('error', 'extra-closing-tag', 'Extra closing ' + close, i, i + 1);
                    else if (text[i] === close) stack.pop();
                }
                for (const start of stack) add('error', 'missing-closing-tag', 'Missing closing ' + close, start, start + 1);
            }
            for(let index=0;index<text.length;index++){
                if(text.startsWith('<<',index)){
                    const end=text.indexOf('>>',index+2);
                    if(end<0){add('error','missing-closing-substitution','Missing closing >> for icon or substitution.',index,index+2);break;}
                    index=end+1;
                }else if(text.startsWith('>>',index)){add('error','extra-closing-substitution','Extra closing >>.',index,index+2);index++;}
            }
        }
        if (text.trim() && options.identity !== false) {
            for (const kind of ['keyword','variable','substitution','format','control']) {
                const sourceIds = new Map(), targetIds = new Map();
                for (const token of source.filter(token => token.kind === kind)) sourceIds.set(token.identity, (sourceIds.get(token.identity) || 0) + 1);
                for (const token of target.filter(token => token.kind === kind)) targetIds.set(token.identity, (targetIds.get(token.identity) || 0) + 1);
                for (const id of new Set([...sourceIds.keys(),...targetIds.keys()])) if ((sourceIds.get(id)||0)!==(targetIds.get(id)||0))
                    add(['variable','substitution'].includes(kind)?'error':'warning', 'clienttext-token-identity', 'Match the source ' + kind + ' tag: ' + id);
            }
        }
        return result;
    }
    function suggestions(field, options = {}) {
        const openedBy = options.openedByChar || '', tokens = tokenize(canonicalSource(field.source));
        // A prefix already typed before an opening brace must remain outside
        // the replacement range. Keyword suggestions retain their complete ID
        // and optional pipe display, including reference metadata.
        const values = [...new Set(tokens.filter(token => token.kind !== 'audio').map(token =>
            token.kind==='variable' && openedBy==='{' ? token.full.slice(token.prefix.length) : token.full)
            .filter(value => !openedBy || value[0]===openedBy))];
        const items = values.map(value => ({ value, label: value, matchText: value, matchTextLower: value.toLocaleLowerCase() }));
        if (field.kind === 'form' && !openedBy) items.unshift({ value: 'NONEXISTENT', label: 'NONEXISTENT', matchText: 'NONEXISTENT', matchTextLower: 'nonexistent', replaceWholeField: true });
        return items;
    }
    return { FORMAT, PARSER_VERSION, canonical, stableStringify, sha256, hash, canonicalSource, audioOnly, sourceHash,
        normalizeUnit, compactUnit, normalizeCompact, leafHash, nodeHash, buildManifest, proofFor, verifyWitness,
        normalizeValues, normalizeReviewed, valuesFor, statusFor, counts, carryForward, tokenize, extractVariables, variableIdentityKey, diagnose, suggestions, copy };
});
