/* Genesis Appearance Studio — persistent, user-controlled themes */
(()=>{'use strict';
 const root=document.documentElement, KEY='genesis.appearance.v1';
 const defaults={mode:'system',accent:'violet',style:'atelier',density:'creator'};
 let state={...defaults};
 try{state={...defaults,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{}
 if(!['system','dark','light'].includes(state.mode))state.mode=defaults.mode;
 if(!['violet','cyan','blue','rose','emerald','amber'].includes(state.accent))state.accent=defaults.accent;
 if(!['atelier','obsidian','graphite','daylight'].includes(state.style))state.style=defaults.style;
 if(!['beginner','creator','professional'].includes(state.density))state.density=defaults.density;
 const systemDark=()=>window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;
 function apply(){
   const dark=state.mode==='system'?systemDark():state.mode==='dark';
   root.dataset.theme=dark?'dark':'light';root.dataset.accent=state.accent;root.dataset.style=state.style;
   const densityChanged=root.dataset.density!==state.density;root.dataset.density=state.density;
   if(densityChanged){const advanced=document.getElementById('segAdv');if(advanced)advanced.open=state.density==='professional';}
   const shell=document.getElementById('studioShell');if(shell)shell.dataset.density=state.density;
   root.style.colorScheme=dark?'dark':'light';
   const meta=document.querySelector('meta[name="theme-color"]');
   if(meta)meta.content=dark?'#0B0E14':'#F5F7FB';
 }
 function save(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch{}apply();renderChoices()}
 function renderChoices(){
   document.querySelectorAll('[data-g-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.gMode===state.mode)));
   document.querySelectorAll('[data-g-accent]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.gAccent===state.accent)));
   document.querySelectorAll('[data-g-style]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.gStyle===state.style)));
   document.querySelectorAll('[data-g-density]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.gDensity===state.density)));
 }
 const panel=document.createElement('section');panel.className='g-theme-panel';panel.id='genesisAppearancePanel';panel.hidden=true;
 panel.setAttribute('aria-label','Appearance settings');
 panel.innerHTML=`<button class="g-theme-close" type="button" aria-label="Close appearance settings">✕</button>
 <h2>Make Genesis yours</h2><p>Choose the atmosphere that feels right. Your choice stays on this device.</p>
 <strong style="font-size:12px">Studio atmosphere</strong><div class="g-theme-row" role="group" aria-label="Studio atmosphere"><button class="g-theme-choice" data-g-style="atelier">Atelier</button><button class="g-theme-choice" data-g-style="obsidian">Obsidian</button><button class="g-theme-choice" data-g-style="graphite">Graphite</button><button class="g-theme-choice" data-g-style="daylight">Daylight</button></div>
 <strong style="font-size:12px">Appearance</strong><div class="g-theme-row" role="group" aria-label="Appearance">
 <button class="g-theme-choice" data-g-mode="system" aria-pressed="false">System</button><button class="g-theme-choice" data-g-mode="dark" aria-pressed="false">Dark</button><button class="g-theme-choice" data-g-mode="light" aria-pressed="false">Light</button></div>
 <strong style="font-size:12px">Accent colour</strong><div class="g-theme-row" role="group" aria-label="Accent colour">
 <button class="g-theme-choice" data-g-accent="violet"><i class="g-swatch" style="background:#9A7BFF"></i>Violet</button>
 <button class="g-theme-choice" data-g-accent="cyan"><i class="g-swatch" style="background:#46D9E8"></i>Cyan</button>
 <button class="g-theme-choice" data-g-accent="blue"><i class="g-swatch" style="background:#76A9FF"></i>Blue</button>
 <button class="g-theme-choice" data-g-accent="rose"><i class="g-swatch" style="background:#F28AA8"></i>Rose</button>
 <button class="g-theme-choice" data-g-accent="emerald"><i class="g-swatch" style="background:#53D6A0"></i>Emerald</button>
 <button class="g-theme-choice" data-g-accent="amber"><i class="g-swatch" style="background:#F0B77A"></i>Amber</button></div>
 <strong style="font-size:12px">Workspace density</strong><div class="g-theme-row" role="group" aria-label="Workspace density"><button class="g-theme-choice" data-g-density="beginner" title="Larger controls and more guidance">Beginner</button><button class="g-theme-choice" data-g-density="creator" title="Balanced tools and spacing">Creator</button><button class="g-theme-choice" data-g-density="professional" title="Compact controls and expanded advanced options">Professional</button></div>
 <p style="margin:8px 0 0">Appearance and density change the interface, never your recordings or scene assets.</p>`;
 const launch=document.createElement('button');launch.className='g-theme-launch';launch.type='button';launch.innerHTML=window.VS&&window.VS.icon?window.VS.icon('palette',18):'◐';launch.setAttribute('aria-label','Open appearance settings');launch.setAttribute('aria-expanded','false');launch.setAttribute('aria-controls',panel.id);
 document.body.append(panel);
 const studioTopbar=document.querySelector('#studioShell .studio-topbar');
 if(studioTopbar){studioTopbar.append(launch);launch.classList.add('g-theme-launch--studio');}
 /* v0.74: no floating button on other pages (it covered content on phones). Appearance opens from the account menu and Settings. */
 window.VS=window.VS||{};
 window.VS.openAppearance=function(){panel.hidden=false;launch.setAttribute('aria-expanded','true');const f=panel.querySelector('.g-theme-choice,button');if(f)f.focus()};
 launch.addEventListener('click',()=>{panel.hidden=!panel.hidden;launch.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)panel.querySelector('button').focus()});
 panel.querySelector('.g-theme-close').addEventListener('click',()=>{panel.hidden=true;launch.setAttribute('aria-expanded','false');launch.focus()});
 panel.addEventListener('click',e=>{const m=e.target.closest('[data-g-mode]'),a=e.target.closest('[data-g-accent]'),st=e.target.closest('[data-g-style]'),d=e.target.closest('[data-g-density]');if(m){state.mode=m.dataset.gMode;save()}if(a){state.accent=a.dataset.gAccent;save()}if(st){state.style=st.dataset.gStyle;save()}if(d){state.density=d.dataset.gDensity;save()}});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){panel.hidden=true;launch.setAttribute('aria-expanded','false');launch.focus()}});
 document.addEventListener('click',e=>{if(!panel.hidden&&!panel.contains(e.target)&&!launch.contains(e.target)){panel.hidden=true;launch.setAttribute('aria-expanded','false')}});
 if(window.matchMedia){const mq=window.matchMedia('(prefers-color-scheme: dark)');mq.addEventListener?.('change',()=>{if(state.mode==='system')apply()})}
 apply();renderChoices();
})();