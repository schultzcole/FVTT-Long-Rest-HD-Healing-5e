import Actor5e from "../../systems/dnd5e/module/actor/entity.js";
import HDLongRestDialog from "./new-long-rest.js";

Hooks.on("init", () => {
    game.settings.register("long-rest-hd-healing", "recovery-mult", {
        name: "Hit Dice Recovery Fraction",
        hint: "The fraction of hit dice to recover on a long rest.",
        scope: "world",
        config: true,
        type: String,
        choices: {
            quarter: "Quarter",
            half: "Half (default)",
            full: "Full",
        },
        default: "half",
    });

    game.settings.register("long-rest-hd-healing", "recovery-mult-lr", {
        name: "Slower Resources Recovery",
        hint: "Recover half of the long rest items/feats/resources/spells uses and slots. (new day items are not affected by this)",
        scope: "world",
        config: true,
        type: Boolean,
        default: false,
    });

    patch_longRest();
});

function patch_longRest() {
    Actor5e.prototype.longRest = async function ({ dialog = true, chat = true } = {}) {
        const data = this.data.data;
        const recoveryMultSetting = game.settings.get("long-rest-hd-healing", "recovery-mult");
        const recoveryMultLrSetting = game.settings.get("long-rest-hd-healing", "recovery-mult-lr");

        // Take note of the initial hit points and number of hit dice the Actor has
        const hd0 = data.attributes.hd;
        const hp0 = data.attributes.hp.value;

        // Maybe present a confirmation dialog
        let newDay = false;
        if (dialog) {
            try {
                newDay = await HDLongRestDialog.hdLongRestDialog({ actor: this, canRoll: hd0 > 0 });
            } catch (err) {
                return;
            }
        }

        // Recover hit points to full, and eliminate any existing temporary HP
        const dhp = data.attributes.hp.value - hp0;
        const updateData = {
            "data.attributes.hp.temp": 0,
            "data.attributes.hp.tempmax": 0,
        };

        // Recover character resources
        for (let [k, r] of Object.entries(data.resources)) {
            if (r.max && (r.sr || (!recoveryMultLrSetting && r.lr))) {
                updateData[`data.resources.${k}.value`] = r.max;
            } else if (recoveryMultLrSetting && r.lr) {
                const halfOfMax = Math.floor(r.max / 2) < 1 ? 1 : Math.floor(r.max / 2);
                const recovered = r.value + halfOfMax > r.max ? r.max : r.value + halfOfMax;
                updateData[`data.resources.${k}.value`] = recovered;
            }
        }

        // Recover spell slots
        for (let [k, v] of Object.entries(data.spells)) {
            if (!v.max && !v.override) continue;
            if (!recoveryMultLrSetting) {
                updateData[`data.spells.${k}.value`] = v.override || v.max;
            } else {
                const max = v.override || v.max;
                const halfOfMax = Math.floor(max / 2) < 1 ? 1 : Math.floor(max / 2);
                const recovered = v.value + halfOfMax > max ? max : v.value + halfOfMax;
                updateData[`data.spells.${k}.value`] = recovered;
            }
        }

        // Recover pact slots.
        const pact = data.spells.pact;
        updateData["data.spells.pact.value"] = pact.override || pact.max;

        // Determine the number of hit dice which may be recovered
        let recoveryMultiplier = 0.5;
        switch (recoveryMultSetting) {
            case "quarter":
                recoveryMultiplier = 0.25;
                break;
            case "half":
                recoveryMultiplier = 0.5;
                break;
            case "full":
                recoveryMultiplier = 1.0;
                break;
            default:
                throw new Error(`Unable to parse recovery multiplier setting, got "${recoveryMultSetting}".`);
        }

        let recoverHD = Math.max(Math.floor(data.details.level * recoveryMultiplier), 1);
        let dhd = 0;

        // Sort classes which can recover HD, assuming players prefer recovering larger HD first.
        const updateItems = this.items
            .filter((item) => item.data.type === "class")
            .sort((a, b) => {
                let da = parseInt(a.data.data.hitDice.slice(1)) || 0;
                let db = parseInt(b.data.data.hitDice.slice(1)) || 0;
                return db - da;
            })
            .reduce((updates, item) => {
                const d = item.data.data;
                if (recoverHD > 0 && d.hitDiceUsed > 0) {
                    let delta = Math.min(d.hitDiceUsed || 0, recoverHD);
                    recoverHD -= delta;
                    dhd += delta;
                    updates.push({ _id: item.id, "data.hitDiceUsed": d.hitDiceUsed - delta });
                }
                return updates;
            }, []);

        // Iterate over owned items, restoring uses per day and recovering Hit Dice
        const recovery = newDay ? ["sr", "lr", "day"] : ["sr", "lr"];
        for (let item of this.items) {
            const d = item.data.data;
            if (d.uses && recovery.includes(d.uses.per)) {
                if (!recoveryMultLrSetting || (recoveryMultLrSetting && ["sr", "day"].includes(d.uses.per))) {
                    updateItems.push({ _id: item.id, "data.uses.value": d.uses.max });
                } else if (recoveryMultLrSetting && d.uses.per === "lr") {
                    const halfOfMax = Math.floor(d.uses.max / 2) < 1 ? 1 : Math.floor(d.uses.max / 2);
                    const recovered = d.uses.value + halfOfMax > d.uses.max ? d.uses.max : d.uses.value + halfOfMax;
                    updateItems.push({ _id: item.id, "data.uses.value": recovered });
                }
            } else if (d.recharge && d.recharge.value) {
                updateItems.push({ _id: item.id, "data.recharge.charged": true });
            }
        }

        // Perform the updates
        await this.update(updateData);
        if (updateItems.length) await this.updateEmbeddedEntity("OwnedItem", updateItems);

        // Display a Chat Message summarizing the rest effects
        let restFlavor;
        switch (game.settings.get("dnd5e", "restVariant")) {
            case "normal":
                restFlavor = game.i18n.localize(newDay ? "DND5E.LongRestOvernight" : "DND5E.LongRestNormal");
                break;
            case "gritty":
                restFlavor = game.i18n.localize("DND5E.LongRestGritty");
                break;
            case "epic":
                restFlavor = game.i18n.localize("DND5E.LongRestEpic");
                break;
        }

        if (chat) {
            ChatMessage.create({
                user: game.user._id,
                speaker: { actor: this, alias: this.name },
                flavor: restFlavor,
                content: game.i18n.format("DND5E.LongRestResult", { name: this.name, health: dhp, dice: dhd }),
            });
        }

        // Return data summarizing the rest effects
        return {
            dhd: dhd,
            dhp: dhp,
            updateData: updateData,
            updateItems: updateItems,
            newDay: newDay,
        };
    };
}
