importScripts('engine.js','string-engine.js');
onmessage=({data})=>{try{const record=NObyStrings.compute(data.word,data.weight);record.geometry=NObyStrings.geometry(record);record.lattice=NObyStrings.latticePoints(record,record.geometry);postMessage({id:data.id,record});}catch(error){postMessage({id:data.id,error:error.message});}};
