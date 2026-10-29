import React,{useLayoutEffect,useRef} from 'react';
import {createRoot,Root} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Button} from './vendor/affectui/button-clean';
import {SegmentedControl} from './vendor/affectui/segmented-control-clean';
import {ThinkingLoader} from './vendor/affectui/thinking-loader-clean';

// React owns only these controls; the existing renderer retains PTY mounts,
// selection, IPC and durable workspace state.
const roots=new WeakMap<Element,Root>();
function render(target:Element,element:React.ReactNode){
 let root=roots.get(target);
 if(!root){target.replaceChildren();root=createRoot(target);roots.set(target,root)}
 flushSync(()=>root!.render(element));
}
function clear(target:Element){const root=roots.get(target);if(root){flushSync(()=>root.unmount());roots.delete(target)}}
const Plus=()=> <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>;
function ReviewTabs({value,current,history,onChange}:{value:string,current:string,history:string,onChange:(value:string)=>void}){
 const host=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{host.current?.querySelectorAll('[role="tab"]').forEach((button,index)=>{const key=index===0?'current':'history';(button as HTMLElement).dataset.reviewView=key;button.setAttribute('aria-pressed',String(key===value));button.classList.toggle('active',key===value)})},[value,current,history]);
 return <div ref={host}><SegmentedControl kind="tabs" variant="underline" fullWidth size="sm" value={value} onChange={onChange} aria-label={`${current} / ${history}`} options={[{value:'current',label:current,controls:'wbCurrentReview'},{value:'history',label:history,controls:'wbReviewHistory'}]}/></div>;
}
(window as any).WhiteboxWorkspaceUI={
 button(target:Element,{label,disabled}:{label:string,disabled:boolean}){render(target,<Button size="sm" icon={<Plus/>} disabled={disabled} data-action="new">{label}</Button>)},
 reviewTabs(target:Element,props:React.ComponentProps<typeof ReviewTabs>){render(target,<ReviewTabs {...props}/>)},
 thinking(target:Element,label:string){render(target,<ThinkingLoader size="sm" variant="plain" phases={[label]} phase={0}/>)},
 actionButton(target:Element,{label,ariaLabel,action,type='button',variant='secondary',icon,value}:{label?:string,ariaLabel?:string,action?:string,type?:'button'|'submit',variant?:'primary'|'secondary'|'ghost',icon?:string,value?:string}){
  render(target,<Button size="sm" variant={variant} type={type} value={value} aria-label={ariaLabel} data-action={action} icon={icon?<span dangerouslySetInnerHTML={{__html:icon}}/>:undefined}>{label}</Button>);
 },
 choices(target:Element,{value,label,options,onChange}:{value:string,label:string,options:{value:string,label:string}[],onChange:(value:string)=>void}){
  render(target,<SegmentedControl size="sm" value={value} aria-label={label} options={options} onChange={onChange}/>);
 },
 clear,
};
