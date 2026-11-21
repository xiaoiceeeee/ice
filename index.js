// 批量导出角色卡（PNG）- 导出选中 / 导出全部，逐张下载 PNG
(function () {
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

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let busy = false;

  function isPng(b) {
    return b && b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47;
  }

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

  function saveFile(name, data) {
    const blob = new Blob([data], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  // 逐个下载传入的角色
  async function downloadMany(chars, getRequestHeaders) {
    const used = new Set();
    const reasons = [];
    let ok = 0;
    toastr.info(`开始导出 ${chars.length} 个角色。如果浏览器询问是否允许下载多个文件，请点"允许"`, '', { timeOut: 8000 });

    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      try {
        const data = await fetchCard(c, getRequestHeaders);
        const base = safeName(c.name);
        let name = `${base}.png`;
        let n = 2;
        while (used.has(name.toLowerCase())) name = `${base}_${n++}.png`;
        used.add(name.toLowerCase());
        saveFile(name, data);
        ok++;
        await sleep(800);
      } catch (e) {
        console.error('[批量导出] 失败：', c.name, e);
        reasons.push(`${c.name}：${e.message}`);
      }
      if (chars.length > 10 && (i + 1) % 10 === 0) {
        toastr.info(`进度 ${i + 1}/${chars.length}`);
      }
    }

    if (!ok) {
      toastr.error('全部导出失败。原因：' + reasons[0], '', { timeOut: 20000 });
      return;
    }
    toastr.success(`导出完成：成功 ${ok} 张` + (reasons.length ? `，失败 ${reasons.length} 张` : ''), '', { timeOut: 10000 });
  }

  // 导出选中的角色
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
      const chars = [];
      for (const p of picked) {
        let c = characters[p.id];
        if (!c && p.name) c = characters.find(x => x.name === p.name);
        if (c && c.avatar) chars.push(c);
      }
      if (!chars.length) {
        toastr.error('找不到所选角色的数据');
        return;
      }
      await downloadMany(chars, getRequestHeaders);
    } catch (e) {
      console.error('[批量导出]', e);
      toastr.error('导出出错：' + e.message, '', { timeOut: 20000 });
    } finally {
      busy = false;
    }
  }

  // 导出全部角色（不受分页、勾选影响）
  async function exportAll() {
    if (busy) return;
    busy = true;
    try {
      const { characters, getRequestHeaders } = await getST();
      const chars = characters.filter(c => c && c.avatar);
      if (!chars.length) {
        toastr.warning('没有可导出的角色');
        return;
      }
      if (!confirm(`将逐张下载全部 ${chars.length} 个角色卡（PNG），大约需要 ${Math.ceil(chars.length * 0.9 / 60)} 分钟，期间请不要关闭页面。确定开始吗？`)) {
        return;
      }
      await downloadMany(chars, getRequestHeaders);
    } catch (e) {
      console.error('[批量导出]', e);
      toastr.error('导出出错：' + e.message, '', { timeOut: 20000 });
    } finally {
      busy = false;
    }
  }

  function addButton() {
    if ($('#batch_export_btn').length) return true;
    const anchor = $('#bulkDeleteButton');
    if (!anchor.length) return false;
    const btn1 = $(
      '<div id="batch_export_btn" class="menu_button menu_button_icon" title="导出选中的角色卡(PNG)">' +
      '<i class="fa-solid fa-file-export"></i><span>导出选中</span></div>'
    ).on('click', exportSelected);
    const btn2 = $(
      '<div id="batch_export_all_btn" class="menu_button menu_button_icon" title="导出全部角色卡(PNG)">' +
      '<i class="fa-solid fa-boxes-packing"></i><span>导出全部</span></div>'
    ).on('click', exportAll);
    anchor.after(btn1);
    btn1.after(btn2);
    return true;
  }

  function addFloatingFallback() {
    if ($('#batch_export_btn').length) return;
    const box = $('<div id="batch_export_btn" style="position:fixed;right:12px;bottom:80px;z-index:9999;display:flex;flex-direction:column;gap:6px;"></div>');
    box.append($('<div class="menu_button">导出选中</div>').on('click', exportSelected));
    box.append($('<div class="menu_button">导出全部</div>').on('click', exportAll));
    $('body').append(box);
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
