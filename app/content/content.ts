import {Store} from "react-chrome-redux";
import { sendSuccessMessage } from './../actions'
import { GenericCallback } from "./../message_service";
interface requestObject {
  url: string;
  method: string;
  requestId: number;
  timeStamp: number;
  responseText: string;
}

interface BgStore{
  ready(): Promise<void>;
  getState(): any;
  dispatch : any;
}
class Intercept {
  store:BgStore
  constructor(){
    this.store = new Store({
      portName: "INTERCEPTOR"
    });
  }
  startMessageListener = () => {
    this.store.ready().then( () => {
      chrome.runtime.onMessage.addListener((request, _, __) => {
        if (request.message === "INTERCEPT_CHECKED") {
          this.interceptSelected("INTERCEPT_CHECKED",request.tabId);
        } else if (request.message === "PAGE_REFRESHED") {
          this.interceptSelected("PAGE_REFRESHED",request.tabId);
        }
      });
    })
  };
  interceptSelected = (message:string, tabId:number) => {
    const presentState = this.store.getState();
    const checkedReqs = presentState.requests.filter(req => {
      return presentState.checkedReqs[req.requestId] && tabId;
    });
    const requestObj = {
      message: message,
      requestsToIntercept: checkedReqs,
      responseText: presentState.responseText,
      statusCodes: presentState.statusCodes,
      contentType: presentState.contentType,
      tabId: tabId
    };

    if (requestObj.requestsToIntercept.length < 1 || !requestObj.tabId || requestObj.requestsToIntercept.find( (req) => req.tabId !== requestObj.tabId )){
      return;
    }
    this.injectScripts(() => {
      this.runInterceptor(requestObj);
    });
    this.store.dispatch(sendSuccessMessage("Interception Success!"))
  };

  setDefaultValues = (responseField, requestsToIntercept, defaultResponseValue) => {
      requestsToIntercept.forEach(req => {
        if (!(responseField[req.requestId])) {
          responseField[req.requestId] = defaultResponseValue;
        }
      });
    return responseField;
  }

  runInterceptor  = (selectedReqs) => {
    let responseTexts = selectedReqs.responseText || {};
    let statusCodes = selectedReqs.statusCodes || {};
    let contentType = selectedReqs.contentType || {};
    this.setDefaultValues(responseTexts,selectedReqs.requestsToIntercept, "")
    this.setDefaultValues(statusCodes,selectedReqs.requestsToIntercept, "200")
    this.setDefaultValues(contentType,selectedReqs.requestsToIntercept, "application/json")

    var selectedInterceptCode =`
     (function(){
       function remove(querySelector) {
         let elemToRemove = document.querySelector(querySelector);
         elemToRemove.parentNode.removeChild(elemToRemove);
       };
       while(document.querySelectorAll("#tmpScript-2").length){
         remove("#tmpScript-2");
       }
       if (window.interceptor) {
         window.interceptor.server.xhr.filters = [];
       }
      function matchUrl(urlfromSinon, urlFromArray){
          const aTag = document.createElement('a');
          aTag.href = urlfromSinon
          requestUrl = new URL(urlFromArray)
          aTagSearchParams = new URLSearchParams(aTag.search)
          reqUrlParams = new URLSearchParams(requestUrl.search)
          aTagSearchParams.sort();
          reqUrlParams.sort()
          return (aTag.hostname === requestUrl.hostname && aTag.pathname === requestUrl.pathname && aTagSearchParams.toString() === reqUrlParams.toString())
      }

       function sinonHandler(requestArray) {
           this.server = sinon.fakeServer.create({ logger: console.log });
           this.server.autoRespond = true;
           this.server.xhr.useFilters = true;
            //If the filter returns true, the request will not be faked - leave original
           this.server.xhr.addFilter(function(method, url, async, username, password) {
             const result = requestArray.requestsToIntercept.find((request) => {
               return matchUrl(url, request.url)
             })
             return !result
           });
           this.server.respondWith((xhr, id) => {
             const respondUrl = requestArray.requestsToIntercept.find((request) => {
                if( matchUrl(xhr.url, request.url ) && xhr.method === request.method){
                  xhr.respond(Number(requestArray.statusCodes[request.requestId]), { "Content-Type": requestArray.contentType[request.requestId] },requestArray.responseText[request.requestId].toString())
                }
             })
           })
           if (window.interceptor) {
            window.interceptor = null
          }
         }
         window.interceptor = new sinonHandler(${JSON.stringify(selectedReqs)});
     })();`

    let script = document.createElement("script");
    script.defer = true;
    script.id = "tmpScript-2";
    script.type = "text/javascript";
    script.textContent = selectedInterceptCode;
    (document.head || document.documentElement).appendChild(script);
    }

  injectScripts = (callback:GenericCallback) => {
    let sinonScript = document.createElement("script");
    sinonScript.defer = false;
    sinonScript.src = chrome.extension.getURL("./lib/sinon.js");
    sinonScript.type="text/javascript";
    sinonScript.id="interceptor-sinon";
    if(!document.getElementById("interceptor-sinon")){
      (document.head || document.documentElement).appendChild(sinonScript);
    } else {
      callback();
    }
    sinonScript.onload = callback;
  };

}
new Intercept().startMessageListener();