// 批量导出角色卡（PNG）- 选中多个角色，一键打包成 ZIP 下载
(function () {
  // ---------- 简易 ZIP 打包（不依赖任何外部库）----------
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function buildZip(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const size = f.data.length;

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true);
      lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, size, true);
      lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);
      parts.push(lh.buffer, name, f.data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true);
      ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, size, true);
      ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(ch.buffer, name);

      offset += 30 + name.length + size;
    }

    let cdSize = 0;
    for (const p of central) cdSize += p.byteLength;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);

    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }

  // ---------- 获取酒馆内部功能 ----------
  async function getST() {
    if (window.SillyTavern && typeof SillyTavern.getContext === 'function') {
      const ctx = SillyTavern.getContext();
      if (ctx.characters && ctx.getRequestHeaders) {
        return { characters: ctx.characters, getRequestHeaders: ctx.getRequestHeaders };
      }
    }
    const mod = await import('../../../../script.js');
    return { characters: mod.characters, getRequestHeaders: mod.getRequestHeaders };
  }

  function safeName(s) {
    return String(s || 'character').replace(/[\\/:*?"<>|]/g, '_').trim() || 'character';
  }

  // ---------- 导出主流程 ----------
  let busy = false;

  function isPng(b) {
    return b && b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47;
  }

  // 依次尝试两种方式获取角色卡 PNG，失败时返回具体原因
  async function fetchCard(c, getRequestHeaders) {
    const errs = [];
    try {
      const res = await fetch('/api/characters/export', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ format: 'png', avatar_url: c.avatar }),
      });
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer());
        if (isPng(buf)) return buf;
        errs.push('接口返回的不是PNG');
      } else {
        errs.push('导出接口错误 ' + res.status);
      }
    } catch (e) {
      errs.push('导出接口异常 ' + e.message);
    }
    try {
      const res = await fetch('/characters/' + encodeURIComponent(c.avatar));
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer());
        if (isPng(buf)) return buf;
        errs.push('直接读取的不是PNG');
      } else {
        errs.push('直接读取错误 ' + res.status);
      }
    } catch (e) {
      errs.push('直接读取异常 ' + e.message);
    }
    throw new Error(errs.join('；'));
  }

  async function exportSelected() {
    if (busy) return;
    const picked = [];
    $('.bulk_select_checkbox:checked').each(function () {
      const holder = $(this).closest('[chid]');
      picked.push({
        id: holder.attr('chid'),
        name: (holder.find('.ch_name').first().text() || '').trim(),
      });
    });

    if (!picked.length) {
      toastr.warning('请先勾选要导出的角色（先点"批量编辑"）');
      return;
    }

    busy = true;
    try {
      const { characters, getRequestHeaders } = await getST();
      const files = [];
      const used = new Set();
      const reasons = [];
      toastr.info(`开始导出 ${picked.length} 个角色…`);

      for (let i = 0; i < picked.length; i++) {
        let c = characters[picked[i].id];
        if (!c && picked[i].name) c = characters.find(x => x.name === picked[i].name);
        if (!c) {
          reasons.push(`找不到角色数据(chid=${picked[i].id})`);
          continue;
        }
        try {
          const data = await fetchCard(c, getRequestHeaders);
          const base = safeName(c.name);
          let name = `${base}.png`;
          let n = 2;
          while (used.has(name.toLowerCase())) name = `${base}_${n++}.png`;
          used.add(name.toLowerCase());
          files.push({ name, data });
        } catch (e) {
          console.error('[批量导出] 失败：', c.name, e);
          reasons.push(`${c.name}：${e.message}`);
        }
      }

      if (!files.length) {
        toastr.error('全部导出失败。原因：' + reasons[0], '', { timeOut: 20000 });
        return;
      }

      const blob = buildZip(files);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const t = new Date();
      const stamp = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}_${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}`;
      a.download = `角色卡导出_${stamp}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);

      toastr.success(`导出完成：成功 ${files.length} 个` + (reasons.length ? `，失败 ${reasons.length} 个` : ''));
    } catch (e) {
      console.error('[批量导出]', e);
      toastr.error('导出出错：' + e.message, '', { timeOut: 20000 });
    } finally {
      busy = false;
    }
  }

  // ---------- 添加按钮 ----------
  function addButton() {
    if ($('#batch_export_btn').length) return true;
    const anchor = $('#bulkDeleteButton');
    if (!anchor.length) return false;
    const btn = $(
      '<div id="batch_export_btn" class="menu_button menu_button_icon" title="导出选中的角色卡(PNG)">' +
      '<i class="fa-solid fa-file-export"></i><span>导出选中</span></div>'
    ).on('click', exportSelected);
    anchor.after(btn);
    return true;
  }

  function addFloatingFallback() {
    if ($('#batch_export_btn').length) return;
    const btn = $(
      '<div id="batch_export_btn" class="menu_button" style="position:fixed;right:12px;bottom:80px;z-index:9999;">导出选中</div>'
    ).on('click', exportSelected);
    $('body').append(btn);
  }

  jQuery(() => {
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      if (addButton()) clearInterval(timer);
      else if (tries > 20) {
        clearInterval(timer);
        addFloatingFallback();
      }
    }, 500);
  });
})();
