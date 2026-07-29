'use strict';
/**
 * public/js/labtm.js
 * LabTrackMS client-side utilities
 * No frameworks — vanilla JS only
 */

(function () {

  // ── Auto-dismiss flash messages ──────────────────────────────
  const flashEls = document.querySelectorAll('.labtm-flash-success, .labtm-flash-error');
  flashEls.forEach(el => {
    setTimeout(() => {
      el.style.transition = 'opacity 0.5s ease';
      el.style.opacity    = '0';
      setTimeout(() => el.remove(), 500);
    }, 6000);
  });

  // ── Mark sidebar active link ──────────────────────────────────
  const currentPath = window.location.pathname;
  document.querySelectorAll('.labtm-sidebar-link').forEach(link => {
    const href = link.getAttribute('href');
    if (href && (currentPath === href || (currentPath.startsWith(href) && href !== '/'))) {
      link.classList.add('active');
    }
  });

  // ── Confirm delete actions ────────────────────────────────────
  document.querySelectorAll('form[data-confirm]').forEach(form => {
    form.addEventListener('submit', e => {
      const msg = form.dataset.confirm || 'Are you sure?';
      if (!window.confirm(msg)) e.preventDefault();
    });
  });

  // ── Select all checkboxes helper ─────────────────────────────
  const selectAllBtn = document.getElementById('labtmSelectAll');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      document.querySelectorAll('[name="test_ids"]').forEach(cb => {
        cb.checked = !cb.checked;
      });
    });
  }

  // ── Patient search autocomplete (order form) ──────────────────
  const patientSearch = document.getElementById('patientSearch');
  const patientHidden = document.getElementById('patient_id_hidden');
  const patientList   = document.getElementById('patientResults');

  if (patientSearch && patientHidden && patientList) {
    let debounce;
    patientSearch.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        const q = patientSearch.value.trim();
        if (q.length < 2) { patientList.innerHTML = ''; return; }
        try {
          const res = await fetch(`/api/patients/search?q=${encodeURIComponent(q)}`);
          const patients = await res.json();
          patientList.innerHTML = patients.map(p =>
            `<li class="labtm-autocomplete-item" data-id="${p.id}" data-name="${p.name}">
               <strong>${p.name}</strong>
               <span class="labtm-text-xs labtm-text-muted"> · ${p.patient_unique_id}</span>
             </li>`
          ).join('') || `<li class="labtm-autocomplete-empty">No patients found</li>`;

          patientList.querySelectorAll('[data-id]').forEach(item => {
            item.addEventListener('click', () => {
              patientHidden.value  = item.dataset.id;
              patientSearch.value  = item.dataset.name;
              patientList.innerHTML = '';
            });
          });
        } catch (err) {
          console.error(err);
        }
      }, 280);
    });

    document.addEventListener('click', e => {
      if (!patientSearch.contains(e.target) && !patientList.contains(e.target)) {
        patientList.innerHTML = '';
      }
    });
  }

  // ── Mobile sidebar toggle ─────────────────────────────────────
  const menuBtn  = document.getElementById('labtmMenuBtn');
  const sidebar  = document.getElementById('labtmSidebar');
  if (menuBtn && sidebar) {
    menuBtn.addEventListener('click', () => sidebar.classList.toggle('open'));
    document.addEventListener('click', e => {
      if (!sidebar.contains(e.target) && !menuBtn.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    });
  }

  // ── Form submit loading state ─────────────────────────────────
  document.querySelectorAll('form').forEach(form => {
    form.addEventListener('submit', () => {
      const btn = form.querySelector('button[type=submit]');
      if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.6';
        btn.style.cursor  = 'not-allowed';
      }
    });
  });

})();
