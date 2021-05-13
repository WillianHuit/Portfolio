const date = new Date();
const year = date.getFullYear();
document.getElementById('year').innerHTML = year;
var delayed;
let ctx = document.getElementById("myChart").getContext("2d");
		let myChart= new Chart(ctx,{
				type:"bar",
					data:{
					labels:['Java','C#','javascript','Python','PHP','NodeJS','SQL','GDscript'],
						datasets:[{
						label:'learning percentage',
						data:[75,75,80,60,60,40,50,60],
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

gsap.timeline({
		defaults:{
			duration: 1,
			stagger: 0.05,
			ease: "bound"
		}
	}).to('.content',{
		opacity: 1
	});