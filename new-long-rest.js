import ShortRestDialog from "../../systems/dnd5e/module/apps/short-rest.js";

export default class HDLongRestDialog extends ShortRestDialog {
    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            template: "modules/long-rest-hd-healing/templates/hd-long-rest.html"
        });
    }

    static async hdLongRestDialog({actor}={}) {
        return new Promise((resolve, reject) => {
          const dlg = new this(actor, {
            title: "Long Rest",
            buttons: {
              rest: {
                icon: '<i class="fas fa-bed"></i>',
                label: "Rest",
                callback: html => {
                  let newDay = false;
                  if (game.settings.get("dnd5e", "restVariant") === "gritty")
                    newDay = html.find('input[name="newDay"]')[0].checked;
                  resolve(newDay);
                }
              },
              cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: "Cancel",
                callback: reject
              }
            },
            close: reject
          });
          dlg.render(true);
        });
      }
}