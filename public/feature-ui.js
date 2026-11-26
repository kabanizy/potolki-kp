// Extend the existing calculator; saved values are restored without consulting today's prices.
let currentUser=null,featuresReady=false,installationWarning='',savedDiscounts=null,discountsEdited=false,savingCalculation=false;
let activeQuote=null,quoteAnimation=null,calculationRequest=0;
const permitted=key=>!!currentUser?.permissions[key];
api=async function(url,opt={}){const r=await fetch(url,{...opt,headers:{'X-Requested-With':'calculator',...opt.headers}});if(r.status===401){location.href='/login';throw Error('Войдите в аккаунт')}const data=await r.json();if(!r.ok)throw Error(data.error||'Ошибка запроса');return data};
const baseDiscountChanged=discountChanged;
discountChanged=function(group){baseDiscountChanged(group);if(currentUser&&!permitted('edit_discount'))for(const suffix of ['DiscountType','DiscountValue','DiscountReason'])$(group+suffix).disabled=true};
const baseRenderTable=renderTable,baseSelected=renderSelectedGroup,baseRecalc=recalc,basePayload=payload,baseUpdateSelected=selectedItemChanged;
function photoPreview(id){const modal=document.createElement('dialog');modal.className='photo-dialog photo-viewer';const img=document.createElement('img'),button=document.createElement('button');img.src='/api/photos/'+encodeURIComponent(id);img.alt='Фотография позиции';button.textContent='Закрыть';button.className='btn';button.onclick=()=>modal.close();modal.onclick=e=>{if(e.target===modal)modal.close()};modal.append(button,img);document.body.append(modal);modal.onclose=()=>modal.remove();modal.showModal()}
function photoControls(item,id,kind){if(!permitted('view_photos')||!id)return '';return `<div class="item-photo-controls"><button type="button" class="btn small ghost" data-photo="${esc(id)}">Посмотреть фото</button><label><input type="checkbox" data-photo-kind="${kind}" data-photo-item="${esc(item.id)}" ${item.include_photo?'checked':''}> Добавить фото в КП</label></div>`}
document.addEventListener('click',e=>{const button=e.target.closest('[data-photo]');if(button)photoPreview(button.dataset.photo)});
document.addEventListener('change',e=>{if(!e.target.matches('[data-photo-kind]'))return;const input=e.target,kind=input.dataset.photoKind,id=input.dataset.photoItem;let row;
  if(kind==='quick')row=quickRows.find(x=>String(x.id)===id);
  else row=items.find(x=>String(x.id)===id);
  if(!row)return;row.include_photo=input.checked;if(input.checked&&!row.photo_id)row.photo_id=findItem(row.price_item_id)?.photo_id;recalc();
});
renderTable=function(arr){const table=baseRenderTable(arr);arr.forEach(it=>{const row=table.querySelector('#row-'+it.id);if(!row)return;const price=row.querySelector('.price'),qty=row.querySelector('.qty'),unit=row.querySelector('input.unit');
  if(price){price.disabled=!permitted(it.name===AUTO_INSTALL_NAME?'edit_install_price':'edit_prices');if(!permitted('view_prices'))price.value=''}
  if(unit)unit.readOnly=!permitted('edit_items');
  if(qty&&!permitted('edit_quantity')){qty.type='checkbox';qty.checked=num(qty.value)>0;qty.removeAttribute('oninput');qty.onchange=()=>{qty.value=qty.checked?'1':'0';qtyChanged(it.id)}}
  if(it.photo_id&&permitted('view_photos')){const button=document.createElement('button');button.className='btn small ghost';button.type='button';button.dataset.photo=it.photo_id;button.textContent='Фото';row.cells[0].append(button)}
  if(it.installation_price!=null){const label=document.createElement('div');label.className='meta';label.textContent='Установка: '+fmt(it.installation_price);row.cells[0].append(label)}
});return table};
renderSelectedGroup=function(group,box){baseSelected(group,box);const selected=items.filter(x=>itemBelongsToGroup(x,group));box.querySelectorAll('tbody tr').forEach((tr,index)=>{const x=selected[index];if(!x)return;tr.cells[0].insertAdjacentHTML('beforeend',photoControls(x,x.photo_id||findItem(x.price_item_id)?.photo_id,'detailed'));const qty=tr.querySelector('.qty-edit'),price=tr.querySelector('.price-edit');if(qty){qty.removeAttribute('onchange');qty.onchange=()=>selectedItemChanged(x.id,'qty',qty.value);qty.disabled=!permitted('edit_quantity')}if(price){price.removeAttribute('onchange');price.onchange=()=>selectedItemChanged(x.id,'price',price.value);price.disabled=!permitted('edit_install_price')}});};
selectedItemChanged=function(id,key,value){const x=items.find(x=>x.id===id);if(x&&key==='price')x.installation_manual=true;baseUpdateSelected(id,key,value)};
function syncInstallationIn(list,quick=false){
  const canvases=list.filter(x=>x.calc_group==='canvas'&&num(quick?x.qty:x.qty)>0),existing=list.find(x=>x.name===AUTO_INSTALL_NAME);
  if(!canvases.length){if(existing)list.splice(list.indexOf(existing),1);installationWarning='';return}
  canvases.forEach(x=>{if(x.installation_rate==null)x.installation_rate=findItem(x.price_item_id)?.installation_price});
  installationWarning=canvases.some(x=>x.installation_rate==null)&&permitted('view_prices')?'Для выбранного полотна не настроена стоимость установки. Обратитесь к администратору.':'';
  if(installationWarning)return;
  const total=canvases.reduce((sum,x)=>sum+num(x.qty)*num(x.installation_rate),0);
  if(existing){if(!existing.installation_manual)existing.price=total;return}
  const base=priceSections.flatMap(s=>s.items).find(x=>x.name===AUTO_INSTALL_NAME);if(!base)return;
  const it=findItem(base.id);list.push({id:Date.now()+Math.random(),price_item_id:base.id,name:base.name,unit:base.unit,section:it.section,calc_group:'services',price:total,qty:1,source:quick?'quick':'price',installation_manual:false,include_photo:false,photo_id:base.photo_id||null,automatic:true});
}
syncAutoInstallation=function(){syncInstallationIn(items);const auto=items.find(x=>x.name===AUTO_INSTALL_NAME),base=priceSections.flatMap(s=>s.items).find(x=>x.name===AUTO_INSTALL_NAME);if(base){const q=$('qty-'+base.id),sum=$('sum-'+base.id);if(q)q.value=auto?.qty||0;const price=$('price-'+base.id);if(price)price.value=auto?.price||0;if(sum)sum.textContent=fmt((auto?.qty||0)*(auto?.price||0))}};
resetQuickRows=function(){quickRows=quickSettings.map((r,i)=>{const item=r.price_item_id?findItem(r.price_item_id):null;return {id:Date.now()+i+Math.random(),settingId:r.id,label:r.name,name:item?.name||r.name,calc_group:item?.calc_group||r.calc_group,price_item_id:item?.id||null,quick_option_id:null,section_id:r.section_id,price_source:r.price_source||'catalog',unit:item?.unit||'шт',price:item?.price??0,qty:0,photo_id:item?.photo_id||null,include_photo:false}});renderQuickRows()};
function quickSetting(r){return quickSettings.find(x=>Number(x.id)===Number(r.settingId))}
function quickOptions(r){const setting=quickSetting(r),bound=setting?.price_item_id;if(bound)return priceSections.flatMap(s=>s.items).filter(x=>x.id===bound);if(!r.section_id)return [];return priceSections.filter(s=>s.id===r.section_id).flatMap(s=>s.items).filter(x=>x.name!==AUTO_INSTALL_NAME)}
function quickCustomOptions(r){return quickSetting(r)?.custom_options||[]}
function renderQuickRow(r){
  const automatic=r.name===AUTO_INSTALL_NAME,oneoff=!r.settingId&&r.price_source==='manual',options=quickOptions(r),custom=quickCustomOptions(r);
  const chosen=options.some(x=>x.id===r.price_item_id);
  const chosenCustom=custom.some(x=>String(x.id)===String(r.quick_option_id)),selectedValue=r.price_item_id?'catalog:'+r.price_item_id:r.quick_option_id?'custom:'+r.quick_option_id:'';
  const selector=automatic?`<strong>${esc(r.name)}</strong>`:oneoff?`<input aria-label="Название строки" data-quick="name" data-id="${r.id}" value="${esc(r.name)}">`:`<select aria-label="Тип или позиция" data-quick="choice" data-id="${r.id}"><option value="" ${selectedValue?'':'selected'}>Без конкретизации — ${esc(r.label||r.name)}</option>${r.price_item_id&&!chosen?`<option value="catalog:${r.price_item_id}" selected>${esc(r.name)} (сохранённая)</option>`:''}${r.quick_option_id&&!chosenCustom?`<option value="custom:${esc(r.quick_option_id)}" selected>${esc(r.name)} (сохранённая)</option>`:''}${options.length?`<optgroup label="Позиции прайса">${options.map(x=>`<option value="catalog:${x.id}" ${selectedValue==='catalog:'+x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</optgroup>`:''}${custom.length?`<optgroup label="Свои позиции">${custom.map(x=>`<option value="custom:${esc(x.id)}" ${selectedValue==='custom:'+x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</optgroup>`:''}</select>`;
  return `<div class="quick-v24" data-row-id="${r.id}"><div class="quick-label">${esc(automatic?'Автоматическая установка':r.label||'Разовая строка')}</div><div class="quick-v24-fields"><div><label>Тип / позиция</label>${selector}${oneoff?`<select aria-label="Раздел КП" data-quick="calc_group" data-id="${r.id}"><option value="services" ${r.calc_group==='services'?'selected':''}>Услуги и материалы</option><option value="canvas" ${r.calc_group==='canvas'?'selected':''}>Полотна</option><option value="products" ${r.calc_group==='products'?'selected':''}>Товары</option></select>`:''}</div><div><label>Количество, ${esc(r.unit||'шт')}</label><input type="number" min="0" step="0.01" value="${r.qty||0}" data-quick="qty" data-id="${r.id}" ${permitted('edit_quantity')?'':'readonly'}></div><div class="price-visible"><label>Цена за единицу, ₽</label><input type="number" min="0" step="0.01" value="${num(r.price)}" data-quick="price" data-id="${r.id}" ${automatic?permitted('edit_install_price')?'':'readonly':!r.price_item_id||permitted('edit_prices')?'':'readonly'}></div><div class="price-visible"><label>Сумма</label><b id="quick-sum-${r.id}">${fmt(num(r.qty)*num(r.price))}</b></div><button class="btn small danger" type="button" data-quick-remove="${r.id}" ${automatic?'disabled':''} title="Удалить из текущего расчёта">×</button></div>${photoControls(r,r.photo_id,'quick')}</div>`;
}
renderQuickRows=function(){const root=$('quickList');if(root)root.innerHTML=quickRows.map(renderQuickRow).join('')||'<p>Постоянных строк нет. Добавьте разовую строку или настройте постоянные.</p>'};
$('quickList').addEventListener('change',e=>{const key=e.target.dataset.quick;if(!key)return;const row=quickRows.find(x=>String(x.id)===e.target.dataset.id);if(!row)return;
  if(key==='choice'){const [type,value]=String(e.target.value).split(':');if(type==='catalog'){const p=findItem(Number(value));Object.assign(row,{price_item_id:p?.id||null,quick_option_id:null,name:p?.name||row.label,unit:p?.unit||'шт',calc_group:p?.calc_group||quickSetting(row)?.calc_group||'services',section:p?.section,price:p?.price??0,photo_id:p?.photo_id||null,include_photo:false,snapshot:false,installation_rate:p?.installation_price??null});if(p&&!permitted('edit_quantity'))row.qty=1}else if(type==='custom'){const option=quickCustomOptions(row).find(x=>String(x.id)===value);Object.assign(row,{price_item_id:null,quick_option_id:option?.id||null,name:option?.name||row.label,unit:option?.unit||'шт',calc_group:quickSetting(row)?.calc_group||'services',section:quickSetting(row)?.name||'Услуги и материалы',price:option?.price??0,photo_id:null,include_photo:false,snapshot:false,installation_rate:null})}else Object.assign(row,{price_item_id:null,quick_option_id:null,name:row.label||row.name,unit:'шт',calc_group:quickSetting(row)?.calc_group||'services',section:quickSetting(row)?.name||'Услуги и материалы',price:0,photo_id:null,include_photo:false,snapshot:false,installation_rate:null})}
  else{row[key]=['price','qty'].includes(key)?Math.max(0,num(e.target.value)):e.target.value;if(key==='price'&&row.name===AUTO_INSTALL_NAME)row.installation_manual=true}
  syncInstallationIn(quickRows,true);renderQuickRows();recalc();
});
$('quickList').addEventListener('input',e=>{if(!['qty','price'].includes(e.target.dataset.quick))return;const r=quickRows.find(x=>String(x.id)===e.target.dataset.id);if(!r)return;r[e.target.dataset.quick]=Math.max(0,num(e.target.value));if(e.target.dataset.quick==='price'&&r.name===AUTO_INSTALL_NAME)r.installation_manual=true;const sum=$('quick-sum-'+r.id);if(sum)sum.textContent=fmt(r.qty*r.price);
  const priorAuto=quickRows.find(x=>x.name===AUTO_INSTALL_NAME);syncInstallationIn(quickRows,true);const auto=quickRows.find(x=>x.name===AUTO_INSTALL_NAME);
  const autoCard=priorAuto?Array.from($('quickList').children).find(el=>el.dataset.rowId===String(priorAuto.id)):null;
  if(auto){if(!autoCard)$('quickList').insertAdjacentHTML('beforeend',renderQuickRow(auto));else{const input=autoCard.querySelector('[data-quick="price"]');if(input!==e.target)input.value=auto.price;const sum=$('quick-sum-'+auto.id);if(sum)sum.textContent=fmt(auto.qty*auto.price)}}else if(autoCard)autoCard.remove();
  recalc()});
$('quickList').addEventListener('click',e=>{const id=e.target.dataset.quickRemove;if(!id)return;quickRows=quickRows.filter(x=>String(x.id)!==id);syncInstallationIn(quickRows,true);renderQuickRows();recalc()});
addQuickRow=function(){if(!permitted('add_oneoff'))return;quickRows.push({id:Date.now()+Math.random(),name:'Новая позиция',calc_group:'services',price_source:'manual',price:0,qty:1,unit:'шт',include_photo:false});renderQuickRows()};
quickCalculationItems=function(){return quickRows.filter(x=>num(x.qty)>0).map(x=>({...x,section:x.section||(x.calc_group==='canvas'?'Полотно':x.calc_group==='products'?'Товары':'Услуги и материалы'),name:String(x.name||x.label||'Позиция').trim(),qty:num(x.qty),price:num(x.price),source:'quick'}))};
toggleQuickSettings=function(){location.href='/quick-settings.html'};
recalc=function(){baseRecalc();const warning=$('installationWarning');if(warning)warning.textContent=installationWarning;if(!permitted('view_prices'))for(const id of ['servicesSubtotal','productsSubtotal','servicesDiscountAmount','productsDiscountAmount','servicesTotal','productsTotal','grandTotal'])if($(id))$(id).textContent='—'};
payload=function(){const p=basePayload();return {...p,discount:savedDiscounts&&!discountsEdited?savedDiscounts:p.discount,items:p.items.map(x=>({...x}))}};
document.addEventListener('input',e=>{if(/^(services|products)Discount/.test(e.target.id))discountsEdited=true});
document.addEventListener('change',e=>{if(/^(services|products)Discount/.test(e.target.id))discountsEdited=true});
function calculationPayload(){
  if(installationWarning){showToast(installationWarning,true);return null}
  const p=payload();
  if(!p.items.length){showToast('Добавьте хотя бы одну позицию.',true);return null}
  return p;
}
async function persistCalculation({publish=false}={}){
  if(savingCalculation||duplicatingCalculation)return null;
  const p=calculationPayload();
  if(!p)return null;
  ++calculationRequest;
  savingCalculation=true;
  try{
    const r=await api(currentId?'/api/calculations/'+currentId:'/api/calculations',{
      method:currentId?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...p,publish})
    });
    currentId=r.id;
    showQuote(r,{reveal:publish});
    await loadHistory();
    return r;
  }finally{savingCalculation=false}
}
async function saveAndShowLink(){
  try{
    const r=await persistCalculation({publish:true});
    if(!r)return;
    setStatus('КП №'+r.id+' сформировано и сохранено');
  }catch(e){showToast(e.message,true)}
}
function setQuoteCollapsed(collapsed){
  const toggle=$('kpToggle');
  $('kpDockBody').hidden=collapsed;
  toggle.setAttribute('aria-expanded',String(!collapsed));
  toggle.setAttribute('aria-label',collapsed?'Развернуть панель КП':'Свернуть панель КП');
  toggle.textContent=collapsed?'+':'−';
}
function showQuote(quote,{reveal=false,editor=quote?.id===currentId}={}){
  const box=$('linkbox'),link=$('kpLink'),address=$('kpAddress');
  const url=quote?.url||quote?.preview_url;
  const highlight=reveal||quote?.id!==activeQuote?.id||quote?.published!==activeQuote?.published;
  activeQuote=quote;
  if(!quote)++calculationRequest;
  box.hidden=!(url||quote?.can_publish);
  if(box.hidden){link.removeAttribute('href');return}
  $('kpTitle').textContent='КП №'+quote.id;
  $('kpState').textContent=quote.published?'Опубликовано':'Черновик';
  box.classList.toggle('is-published',Boolean(quote.published));
  link.hidden=!url;
  if(url)link.href=url;
  else link.removeAttribute('href');
  link.textContent=quote.url?'Открыть КП ↗':'Предпросмотр ↗';
  link.classList.toggle('ghost',!quote.url);
  address.hidden=!url;
  address.textContent=quote.url||(url?'Предпросмотр доступен после входа.':'');
  address.title=quote.url||'';
  $('kpCopy').hidden=!quote.url;
  $('kpPublish').hidden=!quote.can_publish;
  $('kpEditor').hidden=!editor;
  if(!highlight)return;
  setQuoteCollapsed(false);
  quoteAnimation?.cancel();
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
    quoteAnimation=box.animate([
      {transform:'translateY(7px)',boxShadow:'0 0 0 5px rgba(36,75,125,.24), 0 12px 30px rgba(25,59,104,.2)'},
      {transform:'translateY(0)',boxShadow:getComputedStyle(box).boxShadow}
    ],{duration:650,easing:'ease-out'});
  }
}
$('kpToggle').addEventListener('click',()=>setQuoteCollapsed(!$('kpDockBody').hidden));
$('kpEditor').addEventListener('click',()=>{
  const editor=$('calculationEditor');
  editor.focus({preventScroll:true});
  editor.scrollIntoView({block:'start'});
});
$('kpCopy').addEventListener('click',async()=>{
  const url=activeQuote?.url;
  if(!url)return;
  try{await navigator.clipboard.writeText(url)}
  catch{
    const field=document.createElement('textarea');
    field.value=url;
    field.style.position='fixed';
    field.style.opacity='0';
    document.body.append(field);
    field.select();
    const copied=document.execCommand('copy');
    field.remove();
    $('kpCopy').focus({preventScroll:true});
    if(!copied){showToast('Откройте КП и скопируйте адрес из браузера.',true);return}
  }
  showToast('Ссылка на КП скопирована');
});
$('kpPublish').addEventListener('click',async()=>{
  if(!activeQuote?.can_publish||savingCalculation||duplicatingCalculation)return;
  const id=activeQuote.id,button=$('kpPublish');
  savingCalculation=true;
  button.disabled=true;
  try{
    const quote=await api(`/api/calculations/${id}/publish`,{method:'POST'});
    if(activeQuote?.id!==id)return;
    const focusWasHere=document.activeElement===button;
    showQuote(quote,{reveal:true});
    if(focusWasHere)$('kpLink').focus({preventScroll:true});
    showToast('КП №'+id+' опубликовано');
  }catch(e){showToast(e.message,true)}
  finally{button.disabled=false;savingCalculation=false}
});
async function duplicateCalculation(sourceId=null){
  if(duplicatingCalculation||savingCalculation)return;
  const id=sourceId??currentId;
  const useDraft=sourceId===null&&(!id||permitted('edit_own'));
  const draft=useDraft?calculationPayload():null;
  if(useDraft&&!draft)return;
  ++calculationRequest;
  duplicatingCalculation=true;
  document.querySelectorAll('[data-duplicate]').forEach(b=>b.disabled=true);
  try{
    const url=id?`/api/calculations/${id}/duplicate`:'/api/calculations';
    const copy=await api(url,{method:'POST',...(draft?{headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)}:{})});
    if(sourceId===null)currentId=copy.id;
    showQuote(copy,{reveal:true});
    if(sourceId!==null)await loadCalculation(copy.id);
    await loadHistory();
    showToast('Создан расчёт №'+copy.id);
  }catch(e){showToast(e.message,true)}
  finally{duplicatingCalculation=false;document.querySelectorAll('[data-duplicate]').forEach(b=>b.disabled=false)}
}
loadHistory=async function(){if(!permitted('view_history'))return;try{const rows=await api('/api/calculations?q='+encodeURIComponent($('search').value.trim()));rows.sort((a,b)=>historySort.dir==='asc'?historyCompare(a,b,historySort.key):-historyCompare(a,b,historySort.key));updateHistorySortUI();$('historyBody').innerHTML=rows.map(r=>{const edit=permitted(r.owner_id===currentUser.id?'edit_own':'edit_others'),copy=permitted(r.calculation_type==='quick'?'create_quick':'create_calculations');return `<tr><td><b>${r.id}</b></td><td>${r.calculation_type==='quick'?'Быстрый':'Подробный'}</td><td>${esc(formatDateTime(r.created_at))}</td><td>${esc(r.client_name)}</td><td>${esc(r.phone)}</td><td>${esc(r.address)}</td><td>${esc(r.manager)}</td><td>${permitted('view_prices')?fmt(r.total):'—'}</td><td class="actions-col"><button class="btn small ghost" onclick="openCalc(${r.id})">Открыть</button>${copy?`<button class="btn small ghost" data-duplicate onclick="duplicateCalculation(${r.id})">Дублировать расчёт</button>`:''}${edit?`<button class="btn small danger" onclick="delCalc(${r.id})">Удалить</button>`:''}</td></tr>`}).join('')||'<tr><td colspan="9">Расчётов пока нет.</td></tr>'}catch(e){showToast(e.message,true)}};
function showSavedCalculation(d){const modal=document.createElement('dialog');modal.className='photo-dialog';modal.innerHTML='<button class="btn">Закрыть</button><h2>Расчёт №'+d.id+'</h2><p>'+esc(d.client_name)+' · '+esc(d.address)+'</p><div class="table-wrap"><table><thead><tr><th>Позиция</th><th>Количество</th>'+(permitted('view_prices')?'<th>Цена</th><th>Сумма</th>':'')+'</tr></thead><tbody>'+d.items.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+x.qty+' '+esc(x.unit)+'</td>'+(permitted('view_prices')?'<td>'+fmt(x.price)+'</td><td>'+fmt(x.qty*x.price)+'</td>':'')+'</tr>').join('')+'</tbody></table></div>'+(permitted('view_prices')?'<p>Итого: '+fmt(d.total)+'</p>':'');modal.querySelector('button').onclick=()=>modal.close();modal.onclose=()=>modal.remove();document.body.append(modal);modal.showModal()}
async function loadCalculation(id){
  const request=++calculationRequest,d=await api('/api/calculations/'+id);
  if(request!==calculationRequest)return false;
  if(!permitted(d.calculation_type==='quick'?'view_quick':'view_calculator')){showQuote(d,{reveal:true,editor:false});showSavedCalculation(d);return true}
  currentId=id;installationWarning='';savedDiscounts=d.discount;discountsEdited=false;for(const [field,key]of Object.entries({clientName:'client_name',phone:'phone',address:'address',manager:'manager',notes:'notes',roomArea:'area',roomPerimeter:'room_perimeter'}))$(field).value=d[key]??'';clearInputState();
  if(d.calculation_type==='quick'){items=[];quickRows=d.items.map((x,i)=>({...x,id:x.id??Date.now()+i,price:x.price??0,label:x.name,price_source:x.price_item_id?'catalog':'manual',snapshot:true}));renderQuickRows();setCalcMode('quick',true)}
  else{quickRows=[];items=d.items.map((x,i)=>({...x,id:x.id??Date.now()+i,price:x.price??0,snapshot:true}));setCalcMode('detailed',true);for(const x of items){const qty=$('qty-'+x.price_item_id),price=$('price-'+x.price_item_id),unit=$('unit-'+x.price_item_id),sum=$('sum-'+x.price_item_id);if(qty){qty.value=x.qty;if(qty.type==='checkbox')qty.checked=x.qty>0}if(price)price.value=x.price;if(unit)unit.value=x.unit;if(sum)sum.textContent=fmt(x.qty*x.price)}}
  for(const group of ['services','products']){const discount=d.discount?.[group]||{type:'none',value:0,reason:''};$(group+'DiscountType').value=discount.type;discountChanged(group);$(group+'DiscountValue').value=discount.value;$(group+'DiscountReason').value=discount.reason||''}
  showQuote(d,{reveal:true});recalc();return true;
}
async function openCalc(id){
  if(savingCalculation||duplicatingCalculation)return;
  try{if(await loadCalculation(id))showToast('Расчёт №'+id+' открыт')}
  catch(e){showToast(e.message,true)}
}
qtyChanged=function(id,skip=false){const it=findItem(id);if(!it)return;const previous=items.find(x=>x.price_item_id===id),qty=num($('qty-'+id).value);if(qty>0){const next={...it,...previous,id:previous?.id??Date.now()+Math.random(),price_item_id:id,qty,price:num($('price-'+id).value),unit:$('unit-'+id).value,source:'price'};if(it.name===AUTO_INSTALL_NAME)next.installation_manual=true;if(previous)items[items.indexOf(previous)]=next;else items.push(next)}else items=items.filter(x=>x.price_item_id!==id);const sum=$('sum-'+id),row=$('row-'+id);if(sum)sum.textContent=fmt(qty*num($('price-'+id).value));if(row)row.classList.toggle('row-on',qty>0);if(!skip)syncAutoInstallation();renderSelected();recalc()};
const oldNewCalc=newCalc;
newCalc=function(){oldNewCalc();if(!currentId){installationWarning='';savedDiscounts=null;discountsEdited=false;$('manager').value=currentUser?.name||'';recalc()}};
async function initFeatures(){
  const me=await api('/api/me');currentUser=me.user;document.body.classList.toggle('hide-prices',!permitted('view_prices'));
  const nav=document.querySelector('.topbar-right'),group=(title,links)=>links.length?`<details class="nav-group"><summary class="btn small ghost">${title}<span class="nav-arrow" aria-hidden="true"></span></summary><div class="nav-menu">${links.map(([url,label])=>`<a href="/${url}">${label}</a>`).join('')}</div></details>`:'',priceLinks=[],userLinks=[];
  if(permitted('view_catalog'))priceLinks.push(['catalog.html','Просмотр прайса']);
  if(['add_items','edit_items','edit_prices','delete_items','manage_photos'].some(permitted))priceLinks.push(['prices.html','Управление прайсом']);
  if(permitted('manage_users')||permitted('manage_permissions'))userLinks.push(['users.html','Пользователи']);
  if(permitted('manage_invites'))userLinks.push(['invitations.html','Приглашения']);
  nav.innerHTML='<div id="status" class="status"></div>'+group('Прайс',priceLinks)+(permitted('manage_quick')?'<a class="btn small ghost" href="/quick-settings.html">Настройки быстрого расчёта</a>':'')+group('Пользователи',userLinks)+`<span class="meta">${esc(currentUser.name)}</span><form action="/logout" method="post"><button class="btn small ghost">Выйти</button></form>`;
  priceSections=['view_calculator','view_quick'].some(permitted)?await api('/api/prices'):[];quickSettings=permitted('view_quick')?await api('/api/quick-settings'):[];
  renderPrices();resetQuickRows();$('manager').value=currentUser.name;
  if(!permitted('view_calculator')){$('detailedModeBtn').hidden=true;setCalcMode('quick',true)}
  if(!permitted('view_quick'))$('quickModeBtn').hidden=true;
  if(!permitted('view_calculator')&&!permitted('view_quick')){$('detailedCard').hidden=true;$('quickPanel').hidden=true}
  if(!permitted('view_history'))$('historyBody').closest('.card').hidden=true;
  for(const el of document.querySelectorAll('[onclick]')){const call=el.getAttribute('onclick');if(call==='toggleQuickSettings()'&&!permitted('manage_quick'))el.hidden=true;if(call==='addQuickRow()'&&!permitted('add_oneoff'))el.hidden=true;if(['saveCalculation()','saveQuickCalculation()'].includes(call)&&!permitted('publish_kp'))el.hidden=true}
  for(const group of ['services','products']){discountChanged(group);if(!permitted('edit_discount'))for(const suffix of ['DiscountType','DiscountValue','DiscountReason'])$(group+suffix).disabled=true}
  await loadHistory();featuresReady=true;
}
initFeatures().catch(e=>{showToast(e.message,true);setStatus(e.message,true)});
