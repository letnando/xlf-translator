const xlfTranslator = require('./xlf-translator');
const xlfFileProcessor = require('./xlf-file-processor');
const xml2js = require('xml2js');
const constants = require('./constants');
const errors = require('./errors');
const async = require('async');
const chalk = require('chalk');
const StringUtil = require('./utils/string.util');
const logSymbols = require('log-symbols');

function XlfProcessor() {
    // constructor;
}

/**
 * Translate a file automatically from a specific path, this means that it will generate a file that was translated by google
 * @param toLanguages
 * @param callback
 */
XlfProcessor.prototype.translateAndProcessFilesWithGoogleApi = function (toLanguages, callback) {

    async.waterfall([

        (callback) => {

            if (!translatorConfig.fromLanguage) {
                return callback(new Error(errors.NO_FROM_LANGUAGE));
            }

            if (translatorConfig.toLanguage.length === 0) {
                return callback(new Error(errors.NO_TO_LANGUAGE));
            }

            xlfFileProcessor.getXlfSourceFile((err, xlfSourceFile) => {
                callback(err, xlfSourceFile);
            })
        },
        (xlfSourceFile, callback) => {

            this.translateLanguagesAndCreateResources(toLanguages, xlfSourceFile, (err) => {
                callback(err);
            });
        },
    ], (err) => {
        callback(err);
    });
};

/**
 * Translate and create the resources
 * @param languages
 * @param xlfSourceFile
 * @param done
 */
XlfProcessor.prototype.translateLanguagesAndCreateResources = function (languages, xlfSourceFile, done) {

    // extract body and send to the translator class
    const file = xlfSourceFile.xliff.file[0];
    translatorConfig.fromLanguage = translatorConfig.fromLanguage ? translatorConfig.fromLanguage : file.$['source-language'];
    const bodyArray = file.body[0]['trans-unit'];

    async.eachLimit(languages, 1, (languageToTranslate, next) => {

        async.waterfall([
            (callback) => {
                xlfTranslator.translateBody(bodyArray, translatorConfig.fromLanguage, languageToTranslate, (err, newBody) => {
                    callback(err, newBody);
                });
            },
            (newBody, callback) => {
                // substitute the body with the new body and parse it back to the xml before saving
                xlfSourceFile.xliff.file[0].body[0]['trans-unit'] = newBody;

                const builder = new xml2js.Builder();
                const xml = builder.buildObject(xlfSourceFile);
                const path = `${appRoot}${translatorConfig.outputPath}/${constants.OUTPUT_FILE_NAME}.${languageToTranslate}.${constants.FILE_TYPE}`;

                xlfFileProcessor.createXlfFile(path, xml, (err) => {
                    callback(err);
                });
            }
        ], (err) => {
            next(err);
        });
    }, (err) => {
        done(err);
    });
};


/**
 * Get all the messages, check if all output files have the same length for translations,
 * then compare those with the source messages file.
 * @param callback
 */
XlfProcessor.prototype.checkAndUpdateMessagesIfAvailableFromSourceForTranslations = function (done) {

    let sourceMessages;
    let firstFileMessages;

    async.waterfall([

        (callback) => {
            xlfFileProcessor.getXlfSourceFile((err, xlfSourceFile) => {
                sourceMessages = xlfFileProcessor.getXlfMessages(xlfSourceFile);
                callback(err);
            });
        },
        (callback) => {
            const localeFirstFile = translatorConfig.toLanguage[0];
            xlfFileProcessor.getXlFileForLocale(localeFirstFile, (err, firstXlfFile) => {
                firstFileMessages = xlfFileProcessor.getXlfMessages(firstXlfFile);
                callback(err);
            });
        },
        (callback) => {

            let newMessages = [];
            let removeMessages = [];

            if (!sourceMessages || !firstFileMessages) {
                const noFilesError = new Error("Message files or the source file seems to be empty");
                return done(noFilesError);
            }

            // check length, if same return and check the csc
            if (sourceMessages.length === firstFileMessages.length) {
                console.log(logSymbols.success, chalk.gray('No missing files found in source file'));
                return done();
            }

            const firstFileSourceIds = firstFileMessages.map((firstFileMessage) => firstFileMessage.$.id);
            const sourceFileIds = sourceMessages.map((sourceFileMessage) => sourceFileMessage.$.id);

            // check for removals
            firstFileMessages.forEach((firsFileMessage, index) => {
                const notExistingInSourceFile = sourceFileIds.indexOf(firsFileMessage.$.id);
                if (notExistingInSourceFile === -1) {
                    removeMessages.push(firstFileMessages[index]);
                }
            });

            // check for updates
            sourceMessages.forEach((sourceMessage, index) => {
                const notExistingInFirstFileIndex = firstFileSourceIds.indexOf(sourceMessage.$.id);
                if (notExistingInFirstFileIndex === -1) {
                    newMessages.push(sourceMessages[index]);
                }
            });

            xlfFileProcessor.listAllTranslatedXlfFileNames((err, files) => {
                callback(err, files, newMessages, removeMessages);
            })
        },
        (files, newMessages, removeMessages, callback) => {

            async.each(files, (fileName, next) => {

                async.waterfall([
                    (callback) => {

                        const languageTo = fileName.split('.')[1];
                        xlfTranslator.translateBody(newMessages, translatorConfig.fromLanguage, languageTo, (err, translatedBodies) => {

                            if (err && err.statusCode === 429) {
                                return done(err);
                            }
                            callback(err, translatedBodies);
                        })
                    },
                    (translatedBodies, callback) => {

                        xlfFileProcessor.getXlfFileByName(fileName, (err, xlfFile) => {

                            if (translatedBodies && translatedBodies.length) {
                                xlfFile.xliff.file[0].body[0]['trans-unit'] = xlfFile.xliff.file[0].body[0]['trans-unit'].concat(translatedBodies);
                            }
                            callback(err, xlfFile, translatedBodies);
                        })
                    }
                ], (err) => {
                    next(err);
                })

            }, (err) => {
                callback(err);
            });
        }
    ], (err) => {
        done(err);
    })
};

/**
 * Handle if there are existing files
 * @param callback
 */
XlfProcessor.prototype.handleExistingMessages = function (callback) {
    async.waterfall([
        (callback) => {
            // check for updates in source file
            this.checkAndUpdateMessagesIfAvailableFromSourceForTranslations((err) => {
                callback(err);
            });
        }
    ], (err) => {
        callback(err);
    });
};

module.exports = new XlfProcessor();
