export function bindNativePickers(root=document){
  root.querySelectorAll('input[type="date"],input[type="time"],input[type="month"]').forEach(input=>{
    const open=()=>{if(typeof input.showPicker!=='function')return;try{input.showPicker();}catch{/* The browser opens the control itself. */}};
    input.addEventListener('pointerup',open);
    input.closest('label')?.addEventListener('pointerup',event=>{if(event.target!==input){input.focus();open();}});
  });
}
