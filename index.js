/*jslint node:true */
'use strict';
var firebase = require('firebase-admin');
/*
* firebase admin sdk setup
*/
var serviceAccount = require('./hisab-firebase-adminsdk.json');
firebase.initializeApp({
    credential: firebase.credential.cert(serviceAccount),
    databaseURL: "https://hisab-c2bc8.firebaseio.com"
});
var db = firebase.database();

var sendNotifications = function (tokens, payload) {
    if (tokens.length > 0) {
        payload = {'data' : payload};
        console.log(payload);
        firebase.messaging().sendToDevice(tokens, payload).then(function (response) {
            // See the MessagingDevicesResponse reference documentation for
            // the contents of response.
            console.log("Successfully sent message:", response.successCount);
        }).catch(function (error) {
            console.log("Error sending message:", error.code);
        });
    }
};

var getExpensePayload = function (expense, group) {
    var payload;
    payload = {
        'action': '1', //added
        'desc': expense.description,
        'owner_name': expense.owner.name,
        'owner_id': expense.owner.id,
        'timestamp': expense.createdOn.toString(),
        'amount': expense.amount.toString(),
        'group_name': group.name,
        'group_id': group.id
    };
    return payload;
};
/*
 * fetch all groups and store key,path to node value in groups dictionary
 */
var groups_ref = db.ref('groups');
var groups = {};
groups_ref.on('child_added', function (userGroups, preChildKey) {
    userGroups.forEach(function (group) {
        groups[group.key] = userGroups.key + '/' + group.key;
    });
});

/*
* Keeps the tokens updated for every uid
*/
var users_ref = db.ref('users');
var tokens = {};
users_ref.on('child_added', function (user, prevChildKey) {
    var tmpUser = user.val();
    tokens[user.key] = tmpUser.token;
    console.log(tmpUser.name + '\'s token updated');
});


//watch for change in expenses
var expenses_ref = db.ref('expenses');
var shareWith_ref = db.ref('shareWith');
expenses_ref.once('value', function (expensesSnap) {
    
    expensesSnap.forEach(function (groupExpenses) {
        var group_key = groupExpenses.key;
        //all ok
        expenses_ref.child(group_key).on('child_added', function (newExpense, prevChildKey) {
            var tmpExpense;
            tmpExpense = newExpense.val();
            shareWith_ref.child(group_key).once('value', function (usersSnap) {
                //if the group exists
                if (groups[group_key]) {
                    groups_ref.child(groups[group_key]).once('value', function (groupSnap) {
                        //collect registration tokens
                        var tokens_to_inform, group_owner, payload, group;
                        tokens_to_inform = [];
                        group = groupSnap.val();
                        group.id = group_key;
                        group_owner = group.moderator;
                        if (group_owner) {
                            if (tokens[group_owner.id]) { tokens_to_inform.push(tokens[group_owner.id]); }
                        }
                        usersSnap.forEach(function (user) {
                            var cur_user = user.val();
                            if (cur_user) {
                                if (tokens[cur_user.id]) { tokens_to_inform.push(tokens[cur_user.id]); }
                            }
                        });
                        
                        payload = getExpensePayload(tmpExpense, group);
                        sendNotifications(tokens_to_inform, payload);
                    });
                }
            });
        });
    });
});
