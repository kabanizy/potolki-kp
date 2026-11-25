document.querySelector('form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button'),message=document.getElementById('message');button.disabled=true;message.textContent='';
  try{const r=await fetch(form.action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});const data=await r.json();if(!r.ok)throw Error(data.error||'Не удалось войти');location.href='/'}catch(e){message.textContent=e.message}finally{button.disabled=false}
});
