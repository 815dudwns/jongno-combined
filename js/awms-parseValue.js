// awms parseValue — 스캔 raw(바코드/QR/OCR텍스트) → { value, value2(제조년월) }
// 원본: barcodeReaderPopupTemplate.js L1040-1516 (awms.kdn.com, 2026-05-31 추출)
// ZXing decode 결과(result.text) 또는 OCR kdata 텍스트를 그대로 넣으면 됨.
// 출력 value = 설비ID/계기번호/모뎀번호 (vBarcdQr 로 보낼 값)
// ※ 바코드 인식 시 원본은 * 제거 후 호출: text.replace(/\*/g,'') (L643)

function parseValue(text) {
            function lpad(text, padString, length) {
                let temp = "";
                for(let i = 0; i < length; i++) {
                    temp += "" + padString;
                }
                temp += text;
                return temp.substring(temp.length - 6, temp.length);
            }
            let parsedText = "";
			let parsedText2 = "";
			text = text.split("\x00").join("");
            if(text.split(" ").join("").length == 13) {
                var exp = /^\*\d{11}\*$/;
                var clearedText = text.split(" ").join("");
                if(exp.test(clearedText)) {
                    parsedText = clearedText.split("*").join("");
                }
            }
            else if(text.split(" ").join("").length == 11) {
                var exp = /\d{11}/;
                var clearedText = text.split(" ").join("");
                if(exp.test(clearedText)) {
                    parsedText = clearedText;
                }
            }else if(text.split(" ").join("").length == 15){
				var exp = /^\*[\d-]{11,}\*$/;
				var clearedText = text.split(" ").join("");
				if(exp.test(clearedText)) {
				    parsedText = clearedText.replace(/[*-]/g, "");
				}
			}
            else if(text.indexOf("자재번호") > -1 && text.indexOf("제조년월") > -1 && text.indexOf("제조사") > -1 && text.indexOf("자재 ID") > -1) {
                let textArray = [];
                if(text.split('\r').length > 1) {
                    textArray = text.split('\r');
                }
                else if(text.split('\n').length > 1) {
                    textArray = text.split('\n');
                }
                if(textArray.length > 1) {
                    for(let i = 0; i < textArray.length; i++) {
                        if(textArray[i].indexOf("자재 ID") > -1) {
                            let keyValueArray = textArray[i].split(":");
                            parsedText = keyValueArray[1].trim();
                            break;
                        }
                    }
                }
            }
			else if(text.indexOf("제조자") > -1 
			        && text.indexOf("상담전화번호") > -1 
			        && text.indexOf("자재번호") > -1 
			        && text.indexOf("제조년월") > -1 
			        && (text.indexOf("계기ID") > -1 || text.indexOf("계기 ID") > -1)) {
			    let textArray = [];
			    if(text.split('\r').length > 1) {
			        textArray = text.split('\r');
			    }
			    else if(text.split('\n').length > 1) {
			        textArray = text.split('\n');
			    }
			    if(textArray.length > 1) {
			        for(let i = 0; i < textArray.length; i++) {
						if(textArray[i].indexOf("제조년월") > -1) {
						    let keyValueArray = textArray[i].split(":");
						    parsedText2 = "20"+keyValueArray[1].trim().replace(/\D/g, "");
						}
			            if(textArray[i].indexOf("계기ID") > -1 || textArray[i].indexOf("계기 ID") > -1) {
			                let keyValueArray = textArray[i].split(":");
			                parsedText = keyValueArray[1].trim();
			            }
			        }
			    }
			}
            else if(text.indexOf("제조사") > -1 
                    && text.indexOf("상담전화번호") > -1 
                    && text.indexOf("자재번호") > -1 
                    && text.indexOf("제조년월") > -1 
                    && (text.indexOf("계기ID") > -1 || text.indexOf("계기 ID") > -1)) {
                let textArray = [];
                if(text.split('\r').length > 1) {
                    textArray = text.split('\r');
                }
                else if(text.split('\n').length > 1) {
                    textArray = text.split('\n');
                }
                if(textArray.length > 1) {
                    for(let i = 0; i < textArray.length; i++) {
						if(textArray[i].indexOf("제조년월") > -1) {
						    let keyValueArray = textArray[i].split(":");
						    parsedText2 = "20"+keyValueArray[1].trim().replace(/\D/g, "");
						}						
                        if(textArray[i].indexOf("계기ID") > -1 || textArray[i].indexOf("계기 ID") > -1) {
                            let keyValueArray = textArray[i].split(":");
                            parsedText = keyValueArray[1].trim();
                        }
                    }
                }
            }
            else if(text.indexOf("자재번호") > -1 && text.indexOf("제조년월") > -1 && text.indexOf("자재ID") > -1 && text.indexOf("전화번호") > -1) {
                let textArray = [];
                if(text.split('\r').length > 1) {
                    textArray = text.split('\r');
                }
                else if(text.split('\n').length > 1) {
                    textArray = text.split('\n');
                }
                if(textArray.length > 1) {
                    for(let i = 0; i < textArray.length; i++) {
                        if(textArray[i].indexOf("전화번호") > -1) {
                            let keyValueArray = textArray[i].split(":");
                            parsedText = keyValueArray[1].trim();
                            break;
                        }
                    }
                }
            }
            else if(text.indexOf("기기명") > -1 && text.indexOf("제조년월") > -1 && text.indexOf("제조사") > -1 && text.indexOf("제조국가") > -1 && text.indexOf("제조번호") > -1) {
                let textArray = [];
                if(text.split('\r').length > 1) {
                    textArray = text.split('\r');
                }
                else if(text.split('\n').length > 1) {
                    textArray = text.split('\n');
                }
                if(textArray.length > 1) {
                    for(let i = 0; i < textArray.length; i++) {
                        if(textArray[i].indexOf("제조번호") > -1) {
                            let keyValueArray = textArray[i].split(":");
                            parsedText = keyValueArray[1].trim();
                            break;
                        }
                    }
                }
            }
            else if(text.indexOf("PID") > -1 && text.indexOf("YYMM") > -1 && text.indexOf("MID") > -1) {
                let textArray = [];
                textArray = text.split(/\r?\n/);
                if(textArray.length > 1) {
                    for(let i = 0; i < textArray.length; i++) {
						if(textArray[i].indexOf("YYMM") > -1) {
						    let keyValueArray = textArray[i].split(":");
						    parsedText2 = "20"+keyValueArray[1].trim().replace(/\D/g, "");
						}						
                        if(textArray[i].indexOf("MID") > -1) {
                            let keyValueArray = textArray[i].split(":");
                            parsedText = keyValueArray[1].trim();
                        }
                    }
                }else if(textArray.length == 1){ //한 줄에 PID, YYMM, MID 존재
					for (let i = 0; i < textArray.length; i++) {
						const line = textArray[i];
						const yymmMatch = line.match(/YYMM\s*:\s*([\d.]+)/);
						const midMatch = line.match(/MID\s*:\s*([0-9A-Z]+)/);
						if (yymmMatch) {
							parsedText2 = "20" + yymmMatch[1].replace(/\D/g, "");
						}
						if (midMatch) {
							parsedText = midMatch[1];
						}
					}
				}
            }
            else if(text.indexOf("PID") > -1 && text.indexOf("MID") > -1 && text.indexOf("YYMM") == -1) {
                parsedText = text.substring(text.indexOf("MID") + 4, text.length);
                if(parsedText) {
                    parsedText = parsedText.trim();
                }
            }
			else if(text.indexOf("BID.NO") > -1 && text.indexOf("PID") > -1 && text.indexOf("BID") > -1 && text.indexOf("Q'TY") > -1 && text.indexOf("PLID") == -1) {
				let textArray = [];
				textArray = text.split(/\r?\n/);
				if(textArray.length == 1) { //한 줄에 BID.NO, PID, BID, Q'TY 존재
				    for(let i = 0; i < textArray.length; i++) {
						const line = textArray[i];
						const bidMatch = line.match(/BID\s*:\s*([A-Z]?\d+)/);
						//const bidMatch = line.match(/BID\s*:\s*(\d+)/);
						if (bidMatch) {
							const value = bidMatch[1].trim();
							const result = value.indexOf("B") > -1 ? value : lpad(value, "0", 6);
							parsedText = result;
				        }
				        
				        const pidMatch = line.match(/PID\s*:\s*([A-Z]?\d+)/);
				        if(pidMatch){
							const value = bidMatch[1].trim();
							const result = value.indexOf("P") > -1 ? value : lpad(value, "0", 6);
							parsedText2 = result;
						}
				    }
				}else if(textArray.length > 1) {
				    for(let i = 0; i < textArray.length; i++) {
				        if(textArray[i].indexOf("BID") > -1 && textArray[i].indexOf("BID.NO") == -1) {
				            let keyValueArray = textArray[i].split(":");
				            if(keyValueArray[1].indexOf("B") > -1 ){
				                parsedText = keyValueArray[1].trim(); //new QR
				            }else{
				                parsedText = lpad(keyValueArray[1].trim(), "0", 6); //old QR
				            }
				            break;
				        }
				    }
				    
				    for(let i = 0; i < textArray.length; i++) {
				        if(textArray[i].indexOf("PID") > -1) {
				            let keyValueArray = textArray[i].split(":");
				            if(keyValueArray[1].indexOf("P") > -1 ){
				                parsedText2 = keyValueArray[1].trim(); //new QR
				            }else{
				                parsedText2 = lpad(keyValueArray[1].trim(), "0", 6); //old QR
				            }
				            break;
				        }
				    }
				}
			}
            else if(text.indexOf("BID.NO") > -1 && text.indexOf("PID") > -1 && text.indexOf("BID") > -1 && text.indexOf("Q'TY") > -1 && text.indexOf("PLID") == -1) {
                let textArray = [];
                if(text.split('\r').length > 1) {
                    textArray = text.split('\r');
                }
                else if(text.split('\n').length > 1) {
                    textArray = text.split('\n');
                }
                if(textArray.length > 1) {
                    for(let i = 0; i < textArray.length; i++) {
						if(textArray[i].indexOf("BID.NO") > -1) {
						    let keyValueArray = textArray[i].split(":");
						    parsedText2 = keyValueArray[1].trim();
						}
                        if(textArray[i].indexOf("BID") > -1 && textArray[i].indexOf("BID.NO") == -1) {
                            let keyValueArray = textArray[i].split(":");
                            parsedText = lpad(keyValueArray[1].trim(), "0", 6);
                        }
                    }
                }
            }
            else if(text.indexOf("BID.NO") > -1 && text.indexOf("CON.NO") > -1 && text.indexOf("PID") > -1 && text.indexOf("BID") > -1 && text.indexOf("QTY") > -1 && text.indexOf("PLID") == -1) {
                let textArray = [];
                if(text.split('\r').length > 1) {
                    textArray = text.split('\r');
                }
                else if(text.split('\n').length > 1) {
                    textArray = text.split('\n');
                }
                if(textArray.length > 1) {
                    for(let i = 0; i < textArray.length; i++) {
						if(textArray[i].indexOf("BID.NO") > -1) {
						    let keyValueArray = textArray[i].split(":");
						    parsedText2 = keyValueArray[1].trim();
						}
                        if(textArray[i].indexOf("BID") > -1 && textArray[i].indexOf("BID.NO") == -1) {
                            let keyValueArray = textArray[i].split(":");
                            parsedText = lpad(keyValueArray[1].trim(), "0", 6);
                        }
                    }
                }
            }
            else if(text.indexOf("BID NO") > -1 && text.indexOf("PID") > -1 && text.indexOf("PLID") > -1 && text.indexOf("Q'TY") > -1) {
                let textArray = [];
                if(text.split('\r').length > 1) {
                    textArray = text.split('\r');
                }
                else if(text.split('\n').length > 1) {
                    textArray = text.split('\n');
                }
                if(textArray.length > 1) {
                    for(let i = 0; i < textArray.length; i++) {
                        if(textArray[i].indexOf("PLID") > -1) {
                            let keyValueArray = textArray[i].split(":");
                            parsedText = lpad(keyValueArray[1].trim(), "0", 6);
                            break;
                        }
                    }
                    
                    for(let i = 0; i < textArray.length; i++) {
				        if(textArray[i].indexOf("PID") > -1) {
				            let keyValueArray = textArray[i].split(":");
				            if(keyValueArray[1].indexOf("P") > -1 ){
				                parsedText2 = keyValueArray[1].trim(); //new QR
				            }else{
				                parsedText2 = lpad(keyValueArray[1].trim(), "0", 6); //old QR
				            }
				            break;
				        }
				    }
				    
                }
            }
			else if(text.indexOf("BID NO") > -1 && text.indexOf("PID") > -1 && text.indexOf("PLID") > -1 && text.indexOf("Q'YT") > -1) {
			    let textArray = [];
			    textArray = text.split(/\r?\n/);
			    if(textArray.length > 0) { //한 줄에 BID NO,  PID, PLID, Q'YT 존재
			        for(let i = 0; i < textArray.length; i++) {
			            if(textArray[i].indexOf("PLID") > -1) {
							const line = textArray[i];
							const plidMatch = line.match(/PLID\s*:\s*(\d+)/);
							if (plidMatch) {
								parsedText = lpad(plidMatch[1].trim(), "0", 6);
							}
							break;
			            }
			        }
			    }
			}
			else if(text.indexOf("BID.NO") > -1 && text.indexOf("PID") > -1 && text.indexOf("PLID") > -1 && text.indexOf("QTY") > -1) {
                let textArray = [];
                if(text.split('\r').length > 1) {
                    textArray = text.split('\r');
                }
                else if(text.split('\n').length > 1) {
                    textArray = text.split('\n');
                }
                if(textArray.length > 1) {
                    for(let i = 0; i < textArray.length; i++) {
                        if(textArray[i].indexOf("PLID") > -1) {
                            let keyValueArray = textArray[i].split(":");
                            parsedText = lpad(keyValueArray[1].trim(), "0", 6);
                            break;
                        }
                    }
                    
                    for(let i = 0; i < textArray.length; i++) {
				        if(textArray[i].indexOf("PID") > -1) {
				            let keyValueArray = textArray[i].split(":");
				            if(keyValueArray[1].indexOf("P") > -1 ){
				                parsedText2 = keyValueArray[1].trim(); //new QR
				            }else{
				                parsedText2 = lpad(keyValueArray[1].trim(), "0", 6); //old QR
				            }
				            break;
				        }
				    }
				    
                }
            }
            else if(text.indexOf("BID.NO") > -1 && text.indexOf("PID") > -1 && text.indexOf("PLID") > -1 && text.indexOf("Q'TY") > -1) {
                let textArray = [];
                if(text.split('\r').length > 1) {
                    textArray = text.split('\r');
                }
                else if(text.split('\n').length > 1) {
                    textArray = text.split('\n');
                }
                if(textArray.length > 1) {
                    for(let i = 0; i < textArray.length; i++) {
                        if(textArray[i].indexOf("PLID") > -1) {
                            let keyValueArray = textArray[i].split(":");
							if(keyValueArray[1].indexOf("P") > -1 ){
								parsedText = keyValueArray[1].trim();
							}else{
								parsedText = lpad(keyValueArray[1].trim(), "0", 6);	
							}
                            break;
                        }
                    }
                    
                    for(let i = 0; i < textArray.length; i++) {
				        if(textArray[i].indexOf("PID") > -1) {
				            let keyValueArray = textArray[i].split(":");
				            if(keyValueArray[1].indexOf("P") > -1 ){
				                parsedText2 = keyValueArray[1].trim(); //new QR
				            }else{
				                parsedText2 = lpad(keyValueArray[1].trim(), "0", 6); //old QR
				            }
				            break;
				        }
				    }
				    
                }
            }
            else if(text.indexOf("BIN NO") > -1 && text.indexOf("PID") > -1 && text.indexOf("PLID") > -1 && text.indexOf("Q'TY") > -1) {
                let textArray = [];
                if(text.split('\r').length > 1) {
                    textArray = text.split('\r');
                }
                else if(text.split('\n').length > 1) {
                    textArray = text.split('\n');
                }
                if(textArray.length > 1) {
                    for(let i = 0; i < textArray.length; i++) {
                        if(textArray[i].indexOf("PLID") > -1) {
                            let keyValueArray = textArray[i].split(":");
                            parsedText = lpad(keyValueArray[1].trim(), "0", 6);
                            break;
                        }
                    }
                    
                    for(let i = 0; i < textArray.length; i++) {
				        if(textArray[i].indexOf("PID") > -1) {
				            let keyValueArray = textArray[i].split(":");
				            if(keyValueArray[1].indexOf("P") > -1 ){
				                parsedText2 = keyValueArray[1].trim(); //new QR
				            }else{
				                parsedText2 = lpad(keyValueArray[1].trim(), "0", 6); //old QR
				            }
				            break;
				        }
				    }
                }
            }
			else if(text.indexOf("BID NO") > -1 && text.indexOf("PID") > -1 && text.indexOf("PLID") > -1 && text.indexOf("Q' TY") > -1) {
			    let textArray = [];
			    if(text.split('\r').length > 1) {
			        textArray = text.split('\r');
			    }
			    else if(text.split('\n').length > 1) {
			        textArray = text.split('\n');
			    }
			    if(textArray.length > 1) {
			        for(let i = 0; i < textArray.length; i++) {
			            if(textArray[i].indexOf("PLID") > -1) {
			                let keyValueArray = textArray[i].split(":");
			                parsedText = lpad(keyValueArray[1].trim(), "0", 6);
			                break;
			            }
			        }
			        
			        for(let i = 0; i < textArray.length; i++) {
				        if(textArray[i].indexOf("PID") > -1) {
				            let keyValueArray = textArray[i].split(":");
				            if(keyValueArray[1].indexOf("P") > -1 ){
				                parsedText2 = keyValueArray[1].trim(); //new QR
				            }else{
				                parsedText2 = lpad(keyValueArray[1].trim(), "0", 6); //old QR
				            }
				            break;
				        }
				    }
			    }
			}
			else if(text.indexOf("SKT") > -1) {
				const match = text.match(/\d{11}/);
				const textVal = match ? match[0] : text;
				parsedText = textVal;
			}
			else if(text.indexOf("계약번호") > -1 && text.indexOf("자재번호") > -1 && text.indexOf("박스번호") > -1 && text.indexOf("수량") > -1) {
				let textArray = [];
				textArray = text.split(/\r?\n/);
				if(textArray.length > 1) {
				    for(let i = 0; i < textArray.length; i++) {
				        if(textArray[i].indexOf("박스번호") > -1) {
				            let keyValueArray = textArray[i].split(":");
				            parsedText = lpad(keyValueArray[1].trim(), "0", 6);
				            break;
				        }
				    }
				}
			}
			else if(text.indexOf("자재번호") > -1 && text.indexOf("제조년월") > -1 && text.indexOf("자재 ID") > -1) {
				let textArray = [];
				textArray = text.split(/\r?\n/);
				if(textArray.length > 1) {
				    for(let i = 0; i < textArray.length; i++) {
				        if(textArray[i].indexOf("자재 ID") > -1) {
				            let keyValueArray = textArray[i].split(":");
				            parsedText = keyValueArray[1].trim();
				            break;
				        }
				    }
				}
			}
			//20260305 신규패턴 추가 {"pcknNo":"0PCW99JP4QKY3"}
			else if(text.indexOf("pcknNo") > -1) {
				const match = text.match(/"pcknNo"\s*:\s*"([^"]+)"/);
				const textVal = match ? match[0] : text;
				parsedText = textVal;
			}
            else {
                parsedText = text;
            }
            if(parsedText.indexOf("*") > -1) {
                parsedText.replaceAll("*", "");
            }
            return { value: parsedText, value2: parsedText2 };
}
window.parseValue = parseValue;
