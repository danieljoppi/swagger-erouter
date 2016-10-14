'use strict';
const Ajv = require('ajv');
const extend = require('xtend');
const map = require('map-values');

const Schema = require('swagger-parameters/schema');

function Body (parameters = [], definitions = {}) {
    const ajv = new Ajv({
        allErrors: true,
        coerceTypes: true,
        jsonPointers: true,
        useDefaults: true
    });
    const parameter = (parameters || []).find((p) => p.in === 'body');
    if (!parameter) return () => Promise.resolve();

    const body = extend(parameter.schema, {definitions});
    const validate = ajv.compile(body);

    return (req) => new Promise((resolve, reject) => {
        if (validate(req.body)) {
            return resolve();
        } else {
            let errors = validate.errors || [];
            for (let i = 0, len = errors.length; i < len; i++) {
                let error = errors[i],
                    params = error.params;
                if (params.missingProperty) {
                    error.dataPath = `/body/${params.missingProperty}`;
                    delete error.params.missingProperty;
                } else if (error.schemaPath) {
                    let m = /\/properties\/(\w*)/.exec(error.schemaPath);
                    if (m) {
                        error.dataPath = `/body/${m[1]}`;
                    }
                } else {
                    error.dataPath = '/body/x'
                }
            }
            return reject(new Ajv.ValidationError(errors));
        }
    });
}

function Parameters (parameters = []) {
    const ajv = new Ajv({
        coerceTypes: 'array',
        jsonPointers: true,
        useDefaults: true
    });
    const schema = Schema(parameters);
    const validate = ajv.compile(schema);

    const parse = (data) => new Promise((resolve, reject) => {
        // map => copy keys, clones 2 levels
        data = map(data, (value) => extend(value));
        if (validate(data)) {
            resolve(data);
        } else {
            reject(new Ajv.ValidationError(validate.errors));
        }
    });
    return (req) => {
        let obj = {
            path: req.params,
            query: req.query,
            headers: req.headers
        };
        return parse(obj).then(data => {
            req.query = data.query;
            req.params = data.path;
            req.headers = data.headers;
        });
    };
}

module.exports = ({parameters = []}, {definitions = {}}) => {
    const params = [];
    let cache = {};
    for (let i = 0, len = parameters.length; i < len; i++) {
        let param = parameters[i],
            key = `${param.in}_${param.name}`;
        if (!cache[key]) {
            cache[key] = true;
            if (param.in === 'header') {
                param.name = param.name.toLowerCase();
            }
            params.push(param);
        }
    }

    const validateBody = Body(params, definitions);
    const validateParams = Parameters(params);

    return (req, res, next) => {
        Promise.all([
            validateParams(req),
            validateBody(req)
        ]).then(() => {
            return next();
        }).catch(err => {
            err.status = 400;
            return next(err);
        });
    };
};
