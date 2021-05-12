window.onload=function() {
	recursiveFunction();
	textComand();
}
let visible = true;
let count = 0;
let continue_time = true;
let rounds_count = 0;
let aux_count = 0;
let aux_text = "";
let wait = false;
let cursor = document.getElementById('cursor_text');
let float_blox = document.querySelector('float_box');
let code = ["Hi, I'm Willian", "I'm Developer","Welcome to my page!"];

function recursiveFunction(){
	if(visible){
		cursor.className  = "code-text-off";
		visible = false;
	}
	else{
		visible=true;
		cursor.className  = "code-text";
	}
	if(continue_time){
		setTimeout("recursiveFunction()",500);
	}else{
		//cursor.className  = "code-text";
		cursor.style.display = "none";
	}
}

function textComand(){
	let auxArray = code[count].split('');
	aux_text = aux_text + auxArray[aux_count];
	document.getElementById('code_change').innerHTML = aux_text;

	if(aux_count < auxArray.length-1){
		aux_count++;
	}else{
		aux_count = 0;
		aux_text = "";
		wait = true;
		if(count < code.length-1){
			count++;
		}else{
			count = 0;
			continue_time = false;
		}
		
	}



	if(continue_time){
		if(wait){
			setTimeout(() => {
		  		wait = false;
		  		setTimeout("textComand()",100);
			}, 3000);
		}else{
			setTimeout("textComand()",100);
		}
		//setTimeout("textComand()",100);
	}
}

window.addEventListener('scroll',function(){
	let value = window.scrollY;
	
	if(value>200){
		//console.log(value+"-"+screen.width);
		float_box.style.marginTop = value * 0.5 + 'px';
		showCards();
	}
});
let isShowCard = false;
function showCards(){
	if(!isShowCard){
		isShowCard=true;
		gsap.timeline({
		defaults:{
			duration: 0.5,
			stagger: 0.05,
			ease: "elastic.inOut(3)"
		}
	}).to('.card',{
		opacity: 1,
		y:30
	})
	.to('.card',{
		scale: 1,
		y:0
	});
	}
}
const date = new Date();
const year = date.getFullYear();
document.getElementById('year').innerHTML = year;

function moveToStart(){
	window.scroll(0, 0);
	gsap.timeline({
		defaults:{
			duration: 0.5,
			stagger: 0.05,
			ease: "elastic.inOut(3)"
		}
	}).to('.text-principal',{
		scale:1.2,
	})
	.to('.text-principal',{
		scale: 1,
	});
	
}
 
