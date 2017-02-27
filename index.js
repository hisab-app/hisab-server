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
        'type': '1', //added
        'desc': expense.description,
        'owner_name': expense.owner.name,
        'owner_id': expense.owner.id,
        'expense_id': expense.id,
        'timestamp': expense.createdOn.toString(),
        'amount': expense.amount.toString(),
        'group_name': group.name,
        'group_id': group.id
    };
    return payload;
};
/*
 * fetch all groups and store key,path to node value in groups map
 */
var groups_ref = db.ref('groups');
var groups = {};
/**
We need to get a group's detail(moderator, name etc.) if we only have its Id, 
for this we are maintaining a map(dictionary or object) whose key is group Id and value will be a path to group's detail.

set listeners on this passed in users group list.
if a new group is added, then update the gloabl groups map
if a group is removed remove that 

NOTE: we might be getting the groups repeatedly (in case the group is shared with multiple users)
**/
groups_ref.on('child_added', function (userGroups, prevChildKey) {
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
            tmpExpense.id = newExpense.key;
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
                        var collectTokensAndPush = function () {
                            usersSnap.forEach(function (user) {
                                var cur_user = user.val();
                                if (cur_user) {
                                    if (tokens[cur_user.id]) { tokens_to_inform.push(tokens[cur_user.id]); }
                                }
                            });
                            payload = getExpensePayload(tmpExpense, group);
                            console.log('sending to' + tokens_to_inform);
                            sendNotifications(tokens_to_inform, payload);
                        };
                        if (group_owner) {
                            // check if the moderator has the group in his group list
                            groups_ref.child(group_owner.id).on('value', function (groups) {
                                groups.forEach(function (group) {
                                    if (group.key === group_key) {
                                        if (tokens[group_owner.id]) {
                                            tokens_to_inform.push(tokens[group_owner.id]);
                                        }
                                    }
                                });
                                collectTokensAndPush();
                            });
                        } else {
                            collectTokensAndPush();
                        }
                        
                    });
                } else {
                    console.log('group not exist');
                }
            });
        });
    });
});