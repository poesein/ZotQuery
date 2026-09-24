// Isolated local document: no reader tab, selection, annotation or source writes.
import {getDocument,GlobalWorkerOptions} from 'resource://zotero/reader/pdf/build/pdf.mjs';
GlobalWorkerOptions.workerSrc='resource://zotero/reader/pdf/build/pdf.worker.mjs';
window.ZotQueryRenderPDF=async (bytes,pageNumber,crop) => {
 const loading=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,
  cMapUrl:'resource://zotero/reader/pdf/web/cmaps/',cMapPacked:true,
  standardFontDataUrl:'resource://zotero/reader/pdf/web/standard_fonts/'});
 try {
  const pdf=await loading.promise;
  if(pageNumber>pdf.numPages) throw new Error(`页码超出 PDF 范围（共 ${pdf.numPages} 页）`);
  const page=await pdf.getPage(pageNumber),unit=page.getViewport({scale:1});
  // Crop in the displayed, rotation-aware viewport, fractions from top-left.
  const scale=Math.min(4,2400/Math.max(unit.width*crop.width,unit.height*crop.height));
  const viewport=page.getViewport({scale}),canvas=document.createElement('canvas');
  canvas.width=Math.ceil(viewport.width*crop.width);canvas.height=Math.ceil(viewport.height*crop.height);
  if(canvas.width*canvas.height>6000000) throw new Error('页面渲染过大，请缩小区域');
  const context=canvas.getContext('2d');
  await page.render({canvasContext:context,viewport,transform:[1,0,0,1,-viewport.width*crop.x,-viewport.height*crop.y],background:'rgb(255,255,255)'}).promise;
  const image=canvas.toDataURL('image/png').split(',')[1];
  if(image.length>12*1024*1024) throw new Error('图像过大，请缩小区域');
  return {data:image,mimeType:'image/png',width:canvas.width,height:canvas.height,pageCount:pdf.numPages,rotation:viewport.rotation};
 } finally {await loading.destroy();}
};
