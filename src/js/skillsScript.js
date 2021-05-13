const date = new Date();
const year = date.getFullYear();
document.getElementById('year').innerHTML = year;
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