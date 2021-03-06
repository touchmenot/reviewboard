var CommentReplyClasses = {
    diff_comments: RB.DiffCommentReply,
    screenshot_comments: RB.ScreenshotCommentReply,
    file_attachment_comments: RB.FileAttachmentCommentReply
};

this.gReviewRequest = new RB.ReviewRequest({
    id: gReviewRequestId,
    localSitePrefix: gReviewRequestSitePrefix
});

// State variables
var gPendingDiffFragments = {};
var gReviewBanner = $("#review-banner");
var gDraftBanner = $("#draft-banner");
var gDraftBannerButtons = $("input", gDraftBanner);
var gFileAttachmentComments = {};
var gCommentIssueManager = new RB.CommentIssueManager({
    reviewRequest: this.gReviewRequest
});
var issueSummaryTableManager;


// Attach to global RB object
RB.draftBanner = gDraftBanner;
RB.draftBannerButtons = gDraftBannerButtons;

/*
 * "complete" signal handlers for various fields, designed to do
 * post-processing of the values for display.
 */
var gEditorCompleteHandlers = {
    'bugs_closed': function(data) {
        if (gBugTrackerURL == "") {
            return data.join(", ");
        } else {
            return urlizeList(data, function(item) {
                return gBugTrackerURL.replace("%s", item);
            });
        }
    },
    'target_groups': function(data) {
        return urlizeList(data,
            function(item) { return item.url; },
            function(item) { return item.name; }
        );
    },
    'target_people': function(data) {
        return $(urlizeList(data,
                            function(item) { return item.url; },
                            function(item) { return item.username; }))
            .addClass("user")
            .user_infobox();
    },
    'description': linkifyText,
    'testing_done': linkifyText
};


/*
 * Converts an array of items to a list of hyperlinks.
 *
 * By default, this will use the item as the URL and as the hyperlink text.
 * By overriding urlFunc and textFunc, the URL and text can be customized.
 *
 * @param {array}    list            The list of items.
 * @param {function} urlFunc         A function to return the URL for an item
 *                                   in the list.
 * @param {function} textFunc        A function to return the text for an item
 *                                   in the list.
 * @param {function} postProcessFunc Post-process generated elements in the
                                     list.
 *
 * @return A string containing the HTML markup for the list of hyperlinks.
 */
function urlizeList(list, urlFunc, textFunc, postProcessFunc) {
    var str = "";

    for (var i = 0; i < list.length; i++) {
        var item = list[i];
        str += '<a href="';
        str += (urlFunc ? urlFunc(item) : item);
        str += '">';
        str += (textFunc ? textFunc(item) : item);
        str += '</a>';

        if (i < list.length - 1) {
            str += ", ";
        }
    }

    return str;
}


/*
 * Linkifies a block of text, turning URLs, /r/#/ paths, nad bug numbers
 * into clickable links.
 *
 * @param {string} text  The text to linkify.
 *
 * @returns {string} The resulting HTML.
 */
function linkifyText(text) {
    text = text.htmlEncode();

    /* Linkify all URLs. */
    text = text.replace(
        /\b([a-z]+:\/\/[\-A-Za-z0-9+&@#\/%?=~_()|!:,.;]*([\-A-Za-z0-9+@#\/%=~_();|]|))/g,
        function(url) {
            /*
             * We might catch an entity at the end of the URL. This is hard
             * to avoid, since we can't rely on advanced RegExp techniques
             * in all browsers. So, we'll now search for it and prevent it
             * from being part of the URL if it exists. However, a URL with
             * an open bracket will not have its close bracket removed. This
             * was a modification to the original bug fix.
             *
             * See bug 1069.
             */

            var extra = '',
                parts = url.match(/^(.*)(&[a-z]+;|\))$/),
                openParen = url.match(/.*\(.*/);

            if (parts != null && openParen == null) {
                /* We caught an entity. Set it free. */
                url = parts[1];
                extra = parts[2];
            }

            return '<a target="_blank" href="' + url + '">' + url + '</a>' + extra;
        });


    /* Linkify /r/#/ review request numbers */
    text = text.replace(
        /(^|\s|&lt;)\/(r\/\d+(\/[\-A-Za-z0-9+&@#\/%?=~_()|!:,.;]*[\-A-Za-z0-9+&@#\/%=~_()|])?)/g,
        '$1<a target="_blank" href="' + SITE_ROOT + '$2">/$2</a>');

    /* Bug numbers */
    if (gBugTrackerURL != "") {
        text = text.replace(/\b(bug|issue) (#([^.\s]+)|#?(\d+))/gi,
            function(text, m2, m3, bugnum1, bugnum2) {
                /*
                 * The bug number can appear in either of those groups,
                 * depending on how this was typed, so try both.
                 */
                var bugnum = bugnum1 || bugnum2;

                return '<a target="_blank" href="' +
                       gBugTrackerURL.replace("%s", bugnum) +
                       '">' + text + '</a>';
            });
    }

    return text;
}


var DRAFT_FIELD_MAP = {
    bugs_closed: 'bugsClosed',
    change_description: 'changeDescription',
    target_groups: 'targetGroups',
    target_people: 'targetPeople',
    testing_done: 'testingDone'
};


/*
 * Sets a field in the draft.
 *
 * If we're in the process of publishing, this will check if we have saved
 * all fields before publishing the draft.
 *
 * @param {string} field  The field name.
 * @param {string} value  The field value.
 */
function setDraftField(field, value) {
    var data = {};

    data[field] = value;

    gReviewRequest.draft.save({
        data: data,
        buttons: gDraftBannerButtons,
        error: function(model, xhr) {
            var rsp = xhr.errorPayload,
                message;

            reviewRequestEditor.set('publishing', false);

            $('#review-request-warning')
                .delay(6000)
                .fadeOut(400, function() {
                    $(this).hide();
                });

            /* Wrap each term in quotes or a leading 'and'. */
            $.each(rsp.fields[field], function(key, value) {
                var size = rsp.fields[field].length;

                if (key == size - 1 && size > 1) {
                  rsp.fields[field][key] = "and '" + value + "'";
                } else {
                  rsp.fields[field][key] = "'" + value + "'";
                }
            });

            message = rsp.fields[field].join(", ");

            if (rsp.fields[field].length == 1) {
                if (field == "target_groups") {
                    message = "Group " + message + " does not exist.";
                } else {
                    message = "User " + message + " does not exist.";
                }
            } else {
                if (field == "target_groups") {
                    message = "Groups " + message + " do not exist.";
                } else {
                    message = "Users " + message + " do not exist.";
                }
            }

            $("#review-request-warning")
                .show()
                .html(message);
        },
        complete: function() {
            var func = gEditorCompleteHandlers[field],
                fieldName;

            if (_.isFunction(func)) {
                fieldName = DRAFT_FIELD_MAP[field] || field;

                $("#" + field)
                    .empty()
                    .html(func(gReviewRequest.draft.get(fieldName)));
            }
        },
        success: function(model) {
            gDraftBanner.show();

            if (reviewRequestEditor.get('publishing')) {
                reviewRequestEditor.decr('pendingSaveCount');

                if (reviewRequestEditor.get('pendingSaveCount') === 0) {
                    RB.publishDraft();
                }
            }
        }
    });
}


/*
 * An autocomplete() wrapper that converts our autocomplete data into the
 * format expected by jQuery.ui.rbautocomplete. It also adds some additional
 * explanatory text to the bottom of the autocomplete list.
 *
 * options has the following fields:
 *
 *    fieldName   - The field name ("groups" or "people").
 *    nameKey     - The key containing the name in the result data.
 *    descKey     - The key containing the description in the result
 *                  data. This is optional.
 *    extraParams - Extra parameters to send in the query. This is optional.
 *
 * @param {object} options    The options, as listed above.
 *
 * @return {jQuery} This jQuery set.
 */
$.fn.reviewsAutoComplete = function(options) {
    return this.each(function() {
        $(this)
            .rbautocomplete({
                formatItem: function(data) {
                    var s = data[options.nameKey];

                    if (options.descKey && data[options.descKey]) {
                        s += " <span>(" + data[options.descKey] + ")</span>";
                    }

                    return s;
                },
                matchCase: false,
                multiple: true,
                parse: function(data) {
                    var items = data[options.fieldName],
                        parsed = [];

                    for (var i = 0; i < items.length; i++) {
                        var value = items[i];

                        parsed.push({
                            data: value,
                            value: value[options.nameKey],
                            result: value[options.nameKey]
                        });
                    }

                    return parsed;
                },
                url: SITE_ROOT + gReviewRequestSitePrefix + "api/" + options.fieldName + "/",
                extraParams: options.extraParams
            })
            .on("autocompleteshow", function() {
                /*
                 * Add the footer to the bottom of the results pane the
                 * first time it's created.
                 *
                 * Note that we may have multiple .ui-autocomplete-results
                 * elements, and we don't necessarily know which is tied to
                 * this. So, we'll look for all instances that don't contain
                 * a footer.
                 */
                var resultsPane = $(".ui-autocomplete-results:not(" +
                                    ":has(.ui-autocomplete-footer))");

                if (resultsPane.length > 0) {
                    $("<div/>")
                        .addClass("ui-autocomplete-footer")
                        .text("Press Tab to auto-complete.")
                        .appendTo(resultsPane);
                }
            });
    });
};


/*
 * Publishes the draft to the server. This assumes all fields have been
 * saved.
 *
 * Checks all the fields to make sure we have the information we need
 * and then redirects the user to the publish URL.
 */
RB.publishDraft = function() {
    if ($.trim($("#target_groups").html()) == "" &&
        $.trim($("#target_people").html()) == "") {
        alert("There must be at least one reviewer or group " +
        "before this review request can be published.");
    } else if ($.trim($("#summary").html()) == "") {
        alert("The draft must have a summary.");
    } else if ($.trim($("#description").html()) == "") {
        alert("The draft must have a description.");
    } else {
        gReviewRequest.draft.publish({
            buttons: gDraftBannerButtons,
            success: function() {
                window.location = gReviewRequestPath;
            }
        });
    }
}


/*
 * Handles a comment section in a review.
 *
 * This will handle the "Add Comment" link and the draft banners for the
 * review.
 *
 * @param {string} review_id     The review ID.
 * @param {string} context_id    The comment section context ID.
 * @param {string} context_type  The comment section context type.
 *
 * @return {jQuery} This jQuery.
 */
$.fn.commentSection = function(review_id, context_id, context_type) {
    var self = $(this);

    var review = gReviewRequest.createReview(review_id);
    var review_reply = review.createReply();

    var sectionId = context_id;
    var reviewEl = $("#review" + review_id);
    var commentsList = $(".reply-comments", self)
    var bannersEl = $(".banners", reviewEl);
    var bannerButtonsEl = $("input", bannersEl)

    var addCommentLink = $(".add_comment_link", self)
        .click(function() {
            createNewCommentForm();
            return false;
        });

    var yourcomments = $("pre[id^=yourcomment_]", self);

    if (yourcomments.length > 0) {
        createCommentEditor(yourcomments);
        showReplyDraftBanner(review_id);
        addCommentLink.hide();
    }

    /*
     * Creates a new comment form in response to the "Add Comment" link.
     */
    function createNewCommentForm() {
        var userSession = RB.UserSession.instance,
            yourcomment_id = "yourcomment_" + review_id + "_" +
                             context_type;
        if (sectionId) {
            yourcomment_id += "_" + sectionId;
        }

        yourcomment_id += "-draft";

        var yourcomment = $("<li/>")
            .addClass("reply-comment draft editor")
            .attr("id", yourcomment_id + "-item")
            .append($("<dl/>")
                .append($("<dt/>")
                    .append($("<label/>")
                        .attr("for", yourcomment_id)
                        .append($("<a/>")
                            .attr("href", userSession.get('userPageURL'))
                            .html(userSession.get('fullName'))
                        )
                    )
                    .append('<dd><pre id="' + yourcomment_id + '"/></dd>')
                )
            )
            .appendTo(commentsList);

        var yourcommentEl = $("#" + yourcomment_id);
        createCommentEditor(yourcommentEl);
        yourcommentEl
            .inlineEditor("startEdit")
            .on("cancel", function(el, initialValue) {
                if (initialValue == "") {
                    yourcomment.remove();
                }
            });

        addCommentLink.hide();
    }

    /*
     * Registers an inline editor for the comment form, handling setting the
     * comment on the server.
     *
     * @param {jQuery} els  The elements to create editors for.
     *
     * @return {jQuery} The provided elements.
     */
    function createCommentEditor(els) {
        return els.each(function() {
            var $editor = $(this),
                $item = $("#" + $editor[0].id + "-item");

            $editor
                .inlineEditor({
                    cls: "inline-comment-editor",
                    editIconPath: STATIC_URLS["rb/images/edit.png"],
                    notifyUnchangedCompletion: true,
                    multiline: true
                })
                .on({
                    "beginEdit": function() {
                        reviewRequestEditor.incr('editCount');
                    },
                    "complete": function(e, value) {
                        var replyClass,
                            options;

                        reviewRequestEditor.decr('editCount');

                        $editor.html(linkifyText($editor.text()));

                        if (context_type == "body_top") {
                            review_reply.set('bodyTop', value);
                            obj = review_reply;
                        } else if (context_type == "body_bottom") {
                            review_reply.set('bodyBottom', value);
                            obj = review_reply;
                        } else {
                            replyClass = CommentReplyClasses[context_type];

                            if (!replyClass) {
                                /* Shouldn't be reached. */
                                console.log("createCommentEditor received " +
                                            "unexpected context type '%s'",
                                            context_type);
                                return;
                            }

                            obj = $item.data('comment-obj');

                            if (!obj) {
                                obj = new replyClass({
                                    parentObject: review_reply,
                                    replyToID: context_id,
                                    id: $item.data('comment-id')
                                });

                                $item.data('comment-obj', obj);
                            }
                        }

                        obj.ready({
                            ready: function() {
                                if (value) {
                                    obj.set('text', value);
                                    obj.save({
                                        buttons: bannerButtonsEl,
                                        success: function() {
                                            $item.data('comment-id', obj.id);
                                            showReplyDraftBanner(review_id);
                                        }
                                    });
                                } else {
                                    removeCommentFormIfEmpty($item, $editor);
                                }
                            }
                        });
                    },
                    "cancel": function(e) {
                        reviewRequestEditor.decr('editCount');
                        addCommentLink.fadeIn();
                        removeCommentFormIfEmpty($item, $editor);
                    }
                })
        });
    }

    /*
     * Removes a comment form if the contents are empty.
     *
     * @param {jQuery} itemEl    The comment item element.
     * @param {jQuery} editorEl  The inline editor element.
     */
    function removeCommentFormIfEmpty($item, $editor) {
        var value = $editor.inlineEditor("value"),
            obj;

        if (value.stripTags().strip() != "") {
            return;
        }

        obj = $item.data('comment-obj');
        console.assert(obj,
                      'comment-obj data is not populated for the comment ' +
                      'editor');

        if (obj.isNew()) {
            removeCommentForm($item, obj);
        } else {
            obj.destroy({
                success: function() {
                    removeCommentForm($item, obj);
                }
            });
        }
    }

    function removeCommentForm($item, obj) {
        $item
            .data({
                'comment-id': null,
                'comment-obj': null
            })
            .fadeOut(function() {
                $(this).remove();
                addCommentLink.fadeIn();

                /* Find out if we need to discard this. */
                review_reply.discardIfEmpty({
                    buttons: bannerButtonsEl,
                    success: function(discarded) {
                        if (discarded) {
                            /* The reply was discarded. */
                            bannersEl.children().remove();
                        }
                    }
                });
            });
    }

    /*
     * Shows the reply draft banner on the review.
     *
     * @param {string} review_id  The review object's ID.
     */
    function showReplyDraftBanner(review_id) {
        if (bannersEl.children().length == 0) {
            bannersEl.append($.replyDraftBanner(review_reply,
                                                bannerButtonsEl));
        }
    }
};


/* Handles a comment issue in either the review details page, or the
 * inline comment viewer.
 * @param review_id the id of the review that the comment belongs to
 * @param comment_id the id of the comment with the issue
 * @param comment_type dictates the type of comment - either
 *                     "diff_comments", "screenshot_comments" or
 *                     "file_attachment_comments".
 * @param issue_status the initial status of the comment - either
 *                     "open", "resolved" or "dropped"
 * @param interactive true if the user should be shown buttons to
 *                    manipulate the comment issue - otherwise false.
 */
$.fn.commentIssue = function(review_id, comment_id, comment_type,
                             issue_status, interactive) {
    var self = this;
    var OPEN = 'open';
    var RESOLVED = 'resolved';
    var DROPPED = 'dropped';

    var issue_reopen_button = $(".issue-button.reopen", this);
    var issue_resolve_button = $(".issue-button.resolve", this);
    var issue_drop_button = $(".issue-button.drop", this);
    self.review_id = review_id;
    self.comment_id = comment_id;
    self.comment_type = comment_type;
    self.issue_status = issue_status;
    self.interactive = interactive;

    function disableButtons() {
        issue_reopen_button.attr("disabled", true);
        issue_resolve_button.attr("disabled", true);
        issue_drop_button.attr("disabled", true);
    }

    function enableButtons() {
        issue_reopen_button.attr("disabled", false);
        issue_resolve_button.attr("disabled", false);
        issue_drop_button.attr("disabled", false);
    }

    function enterState(state) {
        disableButtons();
        gCommentIssueManager.setCommentState(self.review_id, self.comment_id,
                                             self.comment_type, state);
    }

    issue_reopen_button.click(function() {
        enterState(OPEN);
    });

    issue_resolve_button.click(function() {
        enterState(RESOLVED);
    });

    issue_drop_button.click(function() {
        enterState(DROPPED);
    });

    self.enter_state = function(state) {
        self.state = self.STATES[state];
        self.state.enter();
        if (self.interactive) {
            self.state.showButtons();
            enableButtons();
        }
    }

    self.update_issue_summary_table = function(new_status, old_status, timestamp) {
        var comment_id = self.comment_id,
            entry = $('#summary-table-entry-' + comment_id);

        issueSummaryTableManager.updateStatus(entry, old_status, new_status);
        issueSummaryTableManager.updateCounters(old_status, new_status);
        issueSummaryTableManager.updateTimeStamp(entry, timestamp);
    }

    var open_state = {
        enter: function() {
            $(".issue-button.reopen", self).hide();
            $(".issue-state", self)
                .removeClass("dropped")
                .removeClass("resolved")
                .addClass("open");
            $(".issue-message", self)
                .text("An issue was opened.");
        },
        showButtons: function() {
            $(".issue-button.drop", self).show();
            $(".issue-button.resolve", self).show();
        }
    }

    var resolved_state = {
        enter: function() {
            $(".issue-button.resolve", self).hide();
            $(".issue-button.drop", self).hide();
            $(".issue-state", self)
                .removeClass("dropped")
                .removeClass("open")
                .addClass("resolved");
            $(".issue-message", self)
                .text("The issue has been resolved.");
        },
        showButtons: function() {
            $(".issue-button.reopen", self).show();
        }
    }

    var dropped_state = {
        enter: function() {
            $(".issue-button.resolve", self).hide();
            $(".issue-button.drop", self).hide();
            $(".issue-state", self)
                .removeClass("open")
                .removeClass("resolved")
                .addClass("dropped");
            $(".issue-message", self)
                .text("The issue has been dropped.");
        },
        showButtons: function() {
            $(".issue-button.reopen", self).show();
        }
    }

    self.STATES = {};
    self.STATES[OPEN] = open_state;
    self.STATES[RESOLVED] = resolved_state;
    self.STATES[DROPPED] = dropped_state;

    // Set the comment to the initial state
    self.enter_state(self.issue_status);

    // Register to watch updates on the comment issue state
    gCommentIssueManager
        .registerCallback(self.comment_id, self.enter_state);

    // Register to update issue summary table
    gCommentIssueManager
        .registerCallback(self.comment_id, self.update_issue_summary_table);

    return self;
}



/*
 * Wraps an inline comment so that they can display issue
 * information.
 */
$.fn.issueIndicator = function() {
    var issue_indicator = $('<div/>')
        .addClass('issue-state')
        .appendTo(this);

    var message = $('<span/>')
        .addClass('issue-message')
        .appendTo(issue_indicator);

    return this;
}


/*
 * Wraps an inline comment so that it displays buttons
 * for setting the state of a comment issue.
 */
$.fn.issueButtons = function() {
    var issue_indicator = $(".issue-state", this);

    var buttons = $('<div class="buttons"/>')
        .addClass('buttons')
        .appendTo(issue_indicator);

    var resolve_string = "Fixed";
    var drop_string = "Drop";
    var reopen_string = "Re-open";

    var button_string = '<input type="button" class="issue-button resolve"'
                      + 'value="' + resolve_string + '"/>'
                      + '<input type="button" class="issue-button drop"'
                      + 'value="' + drop_string + '"/>'
                      + '<input type="button" class="issue-button reopen"'
                      + 'value="' + reopen_string + '"/>';

    buttons.append(button_string);

    return this;
}


/*
 * Creates a floating reply banner. The banner will stay in view while the
 * parent review is visible on screen.
 */
$.replyDraftBanner = function(review_reply, bannerButtonsEl) {
    var banner = $("<div/>")
        .addClass("banner")
        .append("<h1>This reply is a draft</h1>")
        .append(" Be sure to publish when finished.")
        .append($('<input type="button"/>')
            .val("Publish")
            .click(function() {
                review_reply.ready({
                    ready: function() {
                        review_reply.set('public', true);
                        review_reply.save({
                            buttons: bannerButtonsEl,
                            success: function() {
                                window.location = gReviewRequestPath;
                            }
                        });
                    }
                });
            })
        )
        .append($('<input type="button"/>')
            .val("Discard")
            .click(function() {
                review_reply.destroy({
                    buttons: bannerButtonsEl,
                    success: function() {
                        window.location = gReviewRequestPath;
                    }
                });
            })
        )
        .floatReplyDraftBanner();

    return banner;
}

/*
 * Floats a reply draft banner. This ensures it's always visible on screen
 * when the review is visible.
 */
$.fn.floatReplyDraftBanner = function() {
    return $(this).each(function() {
        var self = $(this);
        var floatSpacer = null;
        var container = null;

        $(window)
            .scroll(updateFloatPosition)
            .resize(updateSize);
        _.defer(updateFloatPosition);

        function updateSize() {
            if (floatSpacer != null) {
                self.width(floatSpacer.parent().width() -
                           self.getExtents("bpm", "lr"));
            }
        }

        function updateFloatPosition() {
            if (self.parent().length == 0) {
                return;
            }

            /*
             * Something about the below causes the "Publish" button to never
             * show up on IE8. Turn it into a fixed box on IE.
             */
            if ($.browser.msie) {
                return;
            }

            if (floatSpacer == null) {
                floatSpacer = self.wrap($("<div/>")).parent();
                updateSize();
            }

            if (container == null) {
                container = self.closest('.review');
            }

            var containerTop = container.offset().top;
            var windowTop = $(window).scrollTop();
            var topOffset = floatSpacer.offset().top - windowTop;
            var outerHeight = self.outerHeight();

            if (!container.hasClass("collapsed") &&
                topOffset < 0 &&
                containerTop < windowTop &&
                windowTop < (containerTop + container.outerHeight() -
                             outerHeight)) {
                self
                    .addClass('floating')
                    .css({
                        top: 0,
                        position: "fixed"
                    });

                updateSize();
            } else {
                self
                    .removeClass('floating')
                    .css({
                        top: '',
                        position: ''
                    });
            }
        }
    });
}


/*
 * Creates a review form for modifying a new review.
 *
 * This provides editing capabilities for creating or modifying a new
 * review. The list of comments are retrieved from the server, providing
 * context for the comments.
 *
 * @param {RB.Review} review  The review to create or modify.
 *
 * @return {jQuery} The new review form element.
 */
$.reviewForm = function(review) {
    RB.apiCall({
        type: "GET",
        dataType: "html",
        data: {},
        url: gReviewRequestPath + "reviews/draft/inline-form/",
        success: function(html) {
            createForm(html);
        }
    });

    var dlg;
    var buttons;

    /*
     * Creates the actual review form. This is called once we have
     * the HTML for the form from the server.
     *
     * @param {string} formHTML  The HTML content for the form.
     */
    function createForm(formHTML) {
        reviewRequestEditor.incr('editCount');

        dlg = $("<div/>")
            .attr("id", "review-form")
            .appendTo("body") // Needed for scripts embedded in the HTML
            .html(formHTML)
            .modalBox({
                title: "Review for: " + gReviewRequestSummary,
                stretchX: true,
                stretchY: true,
                buttons: [
                    $('<input type="button"/>')
                        .val("Publish Review")
                        .click(function(e) {
                            saveReview(true);
                            return false;
                        }),
                    $('<input type="button"/>')
                        .val("Discard Review")
                        .click(function(e) {
                            reviewRequestEditor.decr('editCount');
                            review.destroy({
                                buttons: buttons,
                                success: function() {
                                    hideReviewBanner();
                                    gReviewBanner.queue(function() {
                                        window.location = gReviewRequestPath;
                                    });
                                }
                            });
                        }),
                    $('<input type="button"/>')
                        .val("Cancel")
                        .click(function() {
                            reviewRequestEditor.decr('editCount');
                        }),
                    $('<input type="button"/>')
                        .val("Save")
                        .click(function() {
                            saveReview();
                            return false;
                        })
                ]
            })
            .keypress(function(e) { e.stopPropagation(); })
            .trigger("ready");

        buttons = $("input", dlg);

        var body_classes = ["body-top", "body-bottom"];

        for (var i in body_classes) {
            var cls = body_classes[i];
            $("." + cls, dlg)
                .inlineEditor({
                    cls: cls + "-editor",
                    extraHeight: 50,
                    forceOpen: true,
                    multiline: true,
                    notifyUnchangedCompletion: true,
                    showButtons: false,
                    showEditIcon: false
                })
                .on({
                    "beginEdit": function() {
                        reviewRequestEditor.incr('editCount');
                    },
                    "cancel complete": function() {
                        reviewRequestEditor.decr('editCount');
                    }
                });
        }

        $("textarea:first", dlg).focus();
        dlg.attr("scrollTop", 0);

        loadDiffFragments("review_draft_diff_comments",
                          "review_draft_comment_container");
    }

    /*
     * Saves the review.
     *
     * This sets the ship_it and body values, and saves all comments.
     */
    function saveReview(publish) {
        $.funcQueue("reviewForm").clear();

        $(".body-top, .body-bottom").inlineEditor("save");

        $(".comment-editable", dlg).each(function() {
            var editable = $(this);
            var comment = editable.data('comment');
            var issue = editable.next()[0];
            var issueOpened = issue ? issue.checked : false;

            if (editable.inlineEditor("dirty") ||
                issueOpened != comment.issue_opened) {
                comment.issue_opened = issueOpened;
                $.funcQueue("reviewForm").add(function() {
                    editable
                        .one("saved", $.funcQueue("reviewForm").next)
                        .inlineEditor("save");
              });
            }
        });

        $.funcQueue("reviewForm").add(function() {
            review.set({
                shipIt: $("#id_shipit", dlg)[0].checked,
                bodyTop: $(".body-top", dlg).text(),
                bodyBottom: $(".body-bottom", dlg).text(),
                public: publish
            });

            reviewRequestEditor.decr('editCount');

            review.save({
                buttons: buttons,
                success: $.funcQueue("reviewForm").next,
                error: function() {
                    console.log(arguments);
                }
            });
        });

        $.funcQueue("reviewForm").add(function() {
            dlg.modalBox("destroy");

            if (publish) {
                hideReviewBanner();
                gReviewBanner.queue(function() {
                    window.location = gReviewRequestPath;
                });
            } else {
                showReviewBanner();
            }
        });

        $.funcQueue("reviewForm").start();
    }
};


/*
 * Adds inline editing capabilities to a comment in the review form.
 *
 * @param {object} comment  A RB.DiffComment, RB.FileAttachmentComment
 *                          or RB.ScreenshotComment instance
 *                          to store the text on and save.
 */
$.fn.reviewFormCommentEditor = function(comment) {
    var self = this;

    return this
        .inlineEditor({
            extraHeight: 50,
            forceOpen: true,
            multiline: true,
            notifyUnchangedCompletion: true,
            showButtons: false,
            showEditIcon: false,
            useEditIconOnly: false
        })
        .on({
            "beginEdit": function() {
                reviewRequestEditor.incr('editCount');
            },
            "cancel": function() {
                reviewRequestEditor.decr('editCount');
            },
            "complete": function(e, value) {
                reviewRequestEditor.decr('editCount');
                comment.set('text', value);
                comment.save({
                    success: function() {
                        self.trigger("saved");
                    }
                });
            }
        })
        .data('comment', comment);
};


/*
 * Adds inline editing capabilities to close description for a review request
 * which have been submitted or discarded.
 *
 * @param {int} type  1: RB.ReviewRequest.CLOSE_DISCARDED
 *                    2: RB.ReviewRequest.CLOSE_SUBMITTED
 */
$.fn.reviewCloseCommentEditor = function(type) {
    return this
        .inlineEditor({
            editIconPath: STATIC_URLS["rb/images/edit.png"],
            multiline: true,
            startOpen: false
        })
        .on("complete", function(e, value) {
            gReviewRequest.close({
                type: type,
                description: value
            });
        });
}


/*
 * Adds inline editing capabilities to a field for a review request.
 */
$.fn.reviewRequestFieldEditor = function() {
    return this.each(function() {
        $(this)
            .inlineEditor({
                cls: this.id + "-editor",
                editIconPath: STATIC_URLS["rb/images/edit.png"],
                multiline: this.tagName == "PRE",
                showButtons: !$(this).hasClass("screenshot-editable"),
                startOpen: this.id == "changedescription",
                useEditIconOnly: $(this).hasClass("comma-editable"),
                showRequiredFlag: $(this).hasClass("required")
            })
            .on({
                "beginEdit": function() {
                    reviewRequestEditor.incr('editCount');
                },
                "cancel": function() {
                    reviewRequestEditor.decr('editCount');
                },
                "complete": function(e, value) {
                    reviewRequestEditor.decr('editCount');
                    setDraftField(this.id, value);
                }
            });
    });
}


/*
 * Registers for updates to the review request. This will cause a pop-up
 * bubble to be displayed when updates of the specified type are displayed.
 *
 * @param {string} lastTimestamp  The last known update timestamp for
 *                                comparison purposes.
 * @param {string} type           The type of update to watch for, or
 *                                undefined for all types.
 */
RB.registerForUpdates = function(lastTimestamp, type) {
    function updateFavIcon(url) {
        var head = $("head");
        head.find("link[rel=icon]").remove();
        head.append($("<link/>")
            .attr({
                href: url,
                rel: "icon",
                type: "image/x-icon"
            }));
    }

    var bubble = $("#updates-bubble");
    var summaryEl;
    var userEl;

    var faviconEl = $("head").find("link[rel=icon]");
    var faviconURL = faviconEl.attr("href");
    var faviconNotifyURL = STATIC_URLS["rb/images/favicon_notify.ico"];

    gReviewRequest.on('updated', function(info) {
        if (bubble.length == 0) {
            updateFavIcon(faviconNotifyURL);

            bubble = $('<div id="updates-bubble"/>');
            summaryEl = $('<span/>')
                .appendTo(bubble);
            bubble.append(" by ");
            userEl = $('<a href="" id="updates-bubble-user"/>')
                .appendTo(bubble);

            bubble
                .append(
                    $('<span id="updates-bubble-buttons"/>')
                        .append($('<a href="#">Update Page</a>')
                            .click(function() {
                                window.location = gReviewRequestPath;
                                return false;
                            }))
                        .append(" | ")
                        .append($('<a href="#">Ignore</a>')
                            .click(function() {
                                bubble.fadeOut();
                                updateFavIcon(faviconURL);
                                return false;
                            }))
                )
                .appendTo(document.body);
        }

        summaryEl.text(info.summary);
        userEl
            .attr('href', info.user.url)
            .text(info.user.fullname || info.user.username);

        bubble
            .hide()
            .css("position", $.browser.msie && $.browser.version == 6
                             ? "absolute" : "fixed")
            .fadeIn();
    });

    gReviewRequest.beginCheckForUpdates(type, lastTimestamp);
}


/*
 * Shows the review banner.
 */
function showReviewBanner() {
    if (gReviewBanner.is(":hidden")) {
        gReviewBanner
            .slideDown()
            .find(".banner")
                .hide()
                .slideDown();
    }
}

// XXX This is temporary until the banner is moved into a new view.
RB.showReviewBanner = showReviewBanner;


/*
 * Hides the review banner.
 */
function hideReviewBanner() {
    gReviewBanner
        .slideUp()
        .find(".banner")
            .slideUp();
}


/*
 * Queues the load of a diff fragment from the server.
 *
 * This will be added to a list, which will fetch the comments in batches
 * based on file IDs.
 *
 * @param {string} queue_name  The name for this load queue.
 * @param {string} comment_id  The ID of the comment.
 * @param {string} key         The key for this request, using the
 *                             filediff and interfilediff.
 */
RB.queueLoadDiffFragment = function(queue_name, comment_id, key) {
    if (!gPendingDiffFragments[queue_name]) {
        gPendingDiffFragments[queue_name] = {};
    }

    if (!gPendingDiffFragments[queue_name][key]) {
        gPendingDiffFragments[queue_name][key] = [];
    }

    gPendingDiffFragments[queue_name][key].push(comment_id);
}


/*
 * Begins the loading of all diff fragments on the page belonging to
 * the specified queue and storing in containers with the specified
 * prefix.
 */
function loadDiffFragments(queue_name, container_prefix) {
    if (!gPendingDiffFragments[queue_name]) {
        return;
    }

    for (var key in gPendingDiffFragments[queue_name]) {
        var comments = gPendingDiffFragments[queue_name][key];
        var url = gReviewRequestPath + "fragments/diff-comments/";

        for (var i = 0; i < comments.length; i++) {
            url += comments[i];

            if (i != comments.length - 1) {
                url += ","
            }
        }

        url += "/?queue=" + queue_name +
               "&container_prefix=" + container_prefix +
               "&" + AJAX_SERIAL;

        $.funcQueue("diff_comments").add(function(url) {
            var e = document.createElement("script");
            e.type = "text/javascript";
            e.src = url;
            document.body.appendChild(e);
        }(url));
    }

    // Clear the list.
    gPendingDiffFragments[queue_name] = {};

    $.funcQueue(queue_name).start();
}


$(document).ready(function() {
    /* Provide support for expanding submenus in the action list. */
    var menuitem = null;

    function showMenu() {
        if (menuitem) {
            $("ul", menuitem).fadeOut("fast");
            menuitem = null;
        }

        $("ul", this).fadeIn("fast");
    }

    function hideMenu() {
        menuitem = $(this);
        setTimeout(function() {
            if (menuitem) {
                $("ul", menuitem).fadeOut("fast");
            }
        }, 400);
    }

    $(".actions > li:has(ul.menu)")
        .hover(showMenu, hideMenu)
        .toggle(showMenu, hideMenu);

    var pendingReview = gReviewRequest.createReview();

    /* Edit Review buttons. */
    $("#review-link, #review-banner-edit").click(function() {
        $.reviewForm(pendingReview);
    });

    $("#shipit-link").click(function() {
        if (confirm("Are you sure you want to post this review?")) {
            pendingReview.set({
                shipIt: true,
                bodyTop: 'Ship It!',
                public: true
            });
            pendingReview.save({
                buttons: null,
                success: function() {
                    hideReviewBanner();
                    gReviewBanner.queue(function() {
                        window.location = gReviewRequestPath;
                    });
                }
            });
        }
    });

    /* Review banner's Publish button. */
    $("#review-banner-publish").click(function() {
        pendingReview.ready({
            ready: function() {
                pendingReview.set('public', true);
                pendingReview.save({
                    buttons: $("input", gReviewBanner),
                    success: function() {
                        hideReviewBanner();
                        gReviewBanner.queue(function() {
                            window.location = gReviewRequestPath;
                        });
                    }
                });
            }
        });
    });

    /* Review banner's Delete button. */
    $("#review-banner-discard").click(function() {
        var dlg = $("<p/>")
            .text("If you discard this review, all related comments will " +
                  "be permanently deleted.")
            .modalBox({
                title: "Are you sure you want to discard this review?",
                buttons: [
                    $('<input type="button" value="Cancel"/>'),
                    $('<input type="button" value="Discard"/>')
                        .click(function(e) {
                            pendingReview.destroy({
                                buttons: $("input", gReviewBanner),
                                success: function() {
                                    hideReviewBanner();
                                    gReviewBanner.queue(function() {
                                        window.location = gReviewRequestPath;
                                    });
                                }
                            });
                        })
                ]
            });
    });

    $("pre.reviewtext, #description, #testing_done").each(function() {
        $(this).html(linkifyText($(this).text()));
    });

    /* Toggle the state of a review */
    $(".collapse-button").click(function() {
        $(this).closest(".box").toggleClass('collapsed');
    });

    /* Expand all reviews */
    $("#expand-all").click(function() {
        $(".collapsed").removeClass("collapsed");
        return false;
    });

    /* Collapse all reviews */
    $("#collapse-all").click(function() {
        $(".box").addClass("collapsed");
        return false;
    });

    $("#submitted-banner #changedescription.editable").reviewCloseCommentEditor(RB.ReviewRequest.CLOSE_SUBMITTED);
    $("#discard-banner #changedescription.editable").reviewCloseCommentEditor(RB.ReviewRequest.CLOSE_DISCARDED);

    if (RB.UserSession.instance.get('authenticated')) {
        if (window["gEditable"]) {
            var dndUploader;

            $(".editable").reviewRequestFieldEditor();

            var targetGroupsEl = $("#target_groups");
            var targetPeopleEl = $("#target_people");

            if (targetGroupsEl.length > 0) {
                targetGroupsEl
                    .inlineEditor("field")
                    .on({
                        "beginEdit": function() {
                            reviewRequestEditor.incr('editCount');
                        },
                        "cancel complete": function() {
                            reviewRequestEditor.decr('editCount');
                        }
                    })
                    .reviewsAutoComplete({
                        fieldName: "groups",
                        nameKey: "name",
                        descKey: "display_name",
                        extraParams: {
                            displayname: 1
                        }
                    });
            }

            if (targetPeopleEl.length > 0) {
                targetPeopleEl
                    .inlineEditor("field")
                    .on({
                        "beginEdit": function() {
                            reviewRequestEditor.incr('editCount');
                        },
                        "cancel complete": function() {
                            reviewRequestEditor.decr('editCount');
                        }
                    })
                    .reviewsAutoComplete({
                        fieldName: "users",
                        nameKey: "username",
                        descKey: "fullname",
                        extraParams: {
                            fullname: 1
                        }
                    });
            }

            /*
             * Warn the user if they try to navigate away with unsaved comments.
             *
             * @param {event} evt The beforeunload event.
             *
             * @return {string} The dialog message (needed for IE).
             */
            window.onbeforeunload = function(evt) {
                if (reviewRequestEditor.get('editCount') > 0) {
                    /*
                     * On IE, the text must be set in evt.returnValue.
                     *
                     * On Firefox, it must be returned as a string.
                     *
                     * On Chrome, it must be returned as a string, but you
                     * can't set it on evt.returnValue (it just ignores it).
                     */
                    var msg = "You have unsaved changes that will " +
                              "be lost if you navigate away from " +
                              "this page.";
                    evt = evt || window.event;

                    evt.returnValue = msg;
                    return msg;
                }
            };

            dndUploader = new RB.DnDUploader({
                reviewRequestEditor: reviewRequestEditor
            });
        }
    }

    loadDiffFragments("diff_fragments", "comment_container");

    issueSummaryTableManager = new RB.IssueSummaryTableView({
        el: $('#issue-summary'),
        model: gCommentIssueManager
    });
    issueSummaryTableManager.render();
});

// vim: set et:sw=4:
