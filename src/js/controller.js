
let hours_working = 1650;
let visible = true;
let count = 0;
let rounds_count = 0;
let aux_count = 0;
let aux_text = "";
let wait = false;
let cursor = document.getElementById('cursor_text');
let float_blox = document.querySelector('float_box');
let code = [" Web Developer", " an engineering student"," Game developer"," Desktop Developer"," Frontend Developer"];

window.onload=function() {
	const date = new Date();
	const year = date.getFullYear();
	let footer = document.getElementById('year');
	footer.innerHTML = year;
	if(cursor != null){
		recursiveFunction();
		textComand();
	}

	
}


function recursiveFunction(){
	if(visible){
		cursor.className  = "code-text-off";
		visible = false;
	}
	else{
		visible=true;
		cursor.className  = "code-text";
	}
	setTimeout("recursiveFunction()",500);
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
		}
		
	}
		if(wait){
			setTimeout(() => {
		  		wait = false;
		  		setTimeout("textComand()",50);
			}, 2000);
		}else{
			setTimeout("textComand()",50);
		}
	
}
let countFacts = true;
let isShowCard = false;
window.addEventListener('scroll',function(){
	let value = window.scrollY;
	
	if(value>80){
		//console.log(value+"-"+screen.width);
		float_box.style.marginTop = value * 0.8 + 'px';
		if(!isShowCard){
			showCards();
		}
	}
	if(value>400 && countFacts && cursor != null){
		startCount();
		countFacts = false;
	}
});

function showCards(){
	if(cursor != null){
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
}



function moveToStart(){
	window.scroll(0, 0);
	if(cursor != null){
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
}

 let tempWH = 0;
function startCount(){
	if(cursor != null){
		if(tempWH<hours_working){
		tempWH = tempWH + 9
		document.getElementById('workingHour').innerHTML = "+"+ (tempWH+2080);
		document.getElementById('hoursDrawing').innerHTML = "+"+ (tempWH+430);
		document.getElementById('coffeConsumed').innerHTML = "+"+ (tempWH);
		}
		if(tempWH<hours_working){
			setTimeout("startCount()",100);
		}
	}
}

function viewMore(e){
	if(e.childNodes[1].className  == "info-project-hide"){
		e.childNodes[1].className  = "info-project-show";
	}else{
		e.childNodes[1].className  = "info-project-hide";
	}
	
}

if(document.querySelector(".image-gallery")) {
	gsap.timeline({
		defaults:{
			duration: 1,
			delay: 0.5,
			stagger: 0.05,
			ease: "elastic.inOut(3)"
		}
	}).to('.onli-text',{
		scale: 2
	}).to('.onli-text',{
		scale: 1
	});
	}

let options={
	root: null,
	rootMargin: '0px',
	threshold: 0.25
};

if(document.querySelector(".content")){
let delayed;
let ctx = document.getElementById("myChart").getContext("2d");
		let myChart= new Chart(ctx,{
				type:"bar",
					data:{
					labels:['Java','C#','javascript','Python','PHP','NodeJS','SQL','GDscript'],
						datasets:[{
						label:'learning percentage',
						data:[75,75,80,65,60,30,50,60],
						backgroundColor:[
						'rgb(219, 7, 7,0.8)',
						'rgb(65, 2, 112,0.8)',
						'rgb(255, 247, 0,0.8)',
						'rgb(2, 112, 245)',
						'rgb(149, 158, 252,0.8)',
						'rgb(8, 201, 8,0.8)',
						'rgb(0, 255, 229,0.8)',
						'rgb(24, 56, 112,0.8)'
						]
						}]
					},
					options:{
						animation: {
						      onComplete: () => {
						        delayed = true;
						      },
						      delay: (context) => {
						        let delay = 0;
						        if (context.type === 'data' && context.mode === 'default' && !delayed) {
						          delay = context.dataIndex * 300 + context.datasetIndex * 100;
						        }
						        return delay;
						      },
						    },
						elements: {
					      bar: {
					        borderWidth: 2,
					      }
					    },

						scales:{
							yAxes:[{
								ticks:{
									beginAtZero:true
								}
							}]
						}
					}
				});


let ctx2 = document.getElementById("ideChart").getContext("2d");
		let myChart2= new Chart(ctx2,{
				type:"bar",
					data:{
					labels:['Visual Studio','Netbeans','Eclipse','Android Studio','Unity','Pycharm','Godot'],
						datasets:[{
						label:'learning percentage',
						data:[80,70,30,40,75,60,50],
						backgroundColor:[
						'rgb(219, 7, 7,0.8)',
						'rgb(65, 2, 112,0.8)',
						'rgb(255, 247, 0,0.8)',
						'rgb(2, 112, 245)',
						'rgb(149, 158, 252,0.8)',
						'rgb(8, 201, 8,0.8)',
						'rgb(0, 255, 229,0.8)',
						'rgb(24, 56, 112,0.8)'
						]
						}]
					},
					options:{
						animation: {
						      onComplete: () => {
						        delayed = true;
						      },
						      delay: (context) => {
						        let delay = 0;
						        if (context.type === 'data' && context.mode === 'default' && !delayed) {
						          delay = context.dataIndex * 400 + context.datasetIndex * 100;
						        }
						        return delay;
						      },
						    },
						elements: {
					      bar: {
					        borderWidth: 2,
					      }
					    },

						scales:{
							yAxes:[{
								ticks:{
									beginAtZero:true
								}
							}]
						}
					}
				});


let ctx3 = document.getElementById("codeEditorChart").getContext("2d");
		let codeEditorChart= new Chart(ctx3,{
				type:"pie",
					data:{
					labels:['Visual Code','Sublime Text'],
						datasets:[{
						label:'learning percentage',
						data:[30,70],
						backgroundColor:[
						'rgb(11, 164, 224,0.8)',
						'rgb(214, 146, 0,0.8)'
						]
						}]
					},
					options:{
						animation: {
						      onComplete: () => {
						        delayed = true;
						      },
						      delay: (context) => {
						        let delay = 0;
						        if (context.type === 'data' && context.mode === 'default' && !delayed) {
						          delay = context.dataIndex * 400 + context.datasetIndex * 100;
						        }
						        return delay;
						      },
						    },
						elements: {
					      bar: {
					        borderWidth: 2,
					      }
					    },

						scales:{
							yAxes:[{
								ticks:{
									beginAtZero:true
								}
							}]
						}
					}
				});
let ctx4 = document.getElementById("officeChart").getContext("2d");
		let officeChart= new Chart(ctx4,{
				type:"bar",
					data:{
					labels:['Word','Power Point','Excel','Access','Visio'],
						datasets:[{
						label:'learning percentage',
						data:[80,70,50,30,10],
						backgroundColor:[
						'rgb(2, 39, 161,0.8)',
						'rgb(255, 136, 0,0.8)',
						'rgb(19, 191, 0,0.8)',
						'rgb(171, 0, 28,0.8)',
						'rgb(38, 201, 255,0.8)'
						]
						}]
					},
					options:{
						animation: {
						      onComplete: () => {
						        delayed = true;
						      },
						      delay: (context) => {
						        let delay = 0;
						        if (context.type === 'data' && context.mode === 'default' && !delayed) {
						          delay = context.dataIndex * 400 + context.datasetIndex * 100;
						        }
						        return delay;
						      },
						    },
						elements: {
					      bar: {
					        borderWidth: 2,
					      }
					    },

						scales:{
							yAxes:[{
								ticks:{
									beginAtZero:true
								}
							}]
						}
					}
				});
let ctx5 = document.getElementById("otherChart").getContext("2d");
		let otherChart= new Chart(ctx5,{
				type:"bar",
					data:{
					labels:['TeamViewer','OBS','Camtasia Studio','PhotoShop','Krita','Illustrator'],
						datasets:[{
						label:'learning percentage',
						data:[50,65,75,70,60,30],
						backgroundColor:[
						'rgb(30, 96, 212,0.8)',
						'rgb(66, 62, 64,0.8)',
						'rgb(20, 179, 41,0.8)',
						'rgb(65, 49, 148,0.8)',
						'rgb(255, 117, 105,0.8)',
						'rgb(227, 18, 0,0.8)'
						]
						}]
					},
					options:{
						animation: {
						      onComplete: () => {
						        delayed = true;
						      },
						      delay: (context) => {
						        let delay = 0;
						        if (context.type === 'data' && context.mode === 'default' && !delayed) {
						          delay = context.dataIndex * 400 + context.datasetIndex * 100;
						        }
						        return delay;
						      },
						    },
						elements: {
					      bar: {
					        borderWidth: 2,
					      }
					    },

						scales:{
							yAxes:[{
								ticks:{
									beginAtZero:true
								}
							}]
						}
					}
				});

	gsap.timeline({
		defaults:{
			duration: 1,
			stagger: 0.05,
			ease: "bound"
		}
	}).to('.content',{
		opacity: 1
	});

}
